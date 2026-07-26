import { unifiedCacheService } from '../unified-cache-service';
import { ensureBase64ForAI } from '../media-executor/fallback-utils';
import { downloadVideoContentToLocalUrl } from '../video-binding-utils';
import {
  buildProviderContextFromAdapterContext,
  sendAdapterRequest,
} from './context';
import { registerModelAdapter } from './registry';
import type {
  AdapterContext,
  VideoGenerationRequest,
  VideoModelAdapter,
} from './types';

const HAPPYHORSE_MODELS = [
  'happyhorse-1.0-t2v',
  'happyhorse-1.0-i2v',
  'happyhorse-1.0-r2v',
  'happyhorse-1.0-video-edit',
];

const HAPPYHORSE_RATIO_MODEL_IDS = new Set([
  'happyhorse-1.0-t2v',
  'happyhorse-1.0-r2v',
]);

const HAPPYHORSE_EDIT_MODEL_ID = 'happyhorse-1.0-video-edit';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_MAX_ATTEMPTS = 1080;
const ALLOWED_RESOLUTIONS = new Set(['720P', '1080P']);
const ALLOWED_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);

type HappyHorseTaskStatus =
  | 'submitted'
  | 'queued'
  | 'processing'
  | 'in_progress'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'error';

interface HappyHorseTaskResponse {
  id?: string;
  task_id?: string;
  object?: string;
  model?: string;
  status?: HappyHorseTaskStatus;
  progress?: number;
  created_at?: number;
  url?: string;
  video_url?: string;
  error?: string | { code?: string; message?: string };
}

interface HappyHorseVideoParameters {
  resolution: string;
  ratio?: string;
  duration?: number;
  watermark?: boolean;
  seed?: number;
  audio_setting?: 'auto' | 'origin';
}

function isHappyHorseModelId(modelId?: string | null): boolean {
  return Boolean(modelId?.toLowerCase().includes('happyhorse'));
}

function normalizeRatio(value?: string | null): string | undefined {
  const normalized = value?.trim().replace(/[xX]/g, ':');
  return normalized && ALLOWED_RATIOS.has(normalized) ? normalized : undefined;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function inferRatioFromDimensions(value: string): string | undefined {
  const match = value.match(/^(\d{2,5})[xX](\d{2,5})$/);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }
  const divisor = gcd(width, height);
  return normalizeRatio(`${width / divisor}:${height / divisor}`);
}

function inferResolutionFromDimensions(value: string): string | undefined {
  const match = value.match(/^(\d{2,5})[xX](\d{2,5})$/);
  if (!match) return undefined;
  const height = Number(match[2]);
  if (height >= 1000) return '1080P';
  if (height >= 700) return '720P';
  return undefined;
}

function normalizeResolution(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const upper = trimmed.toUpperCase();
  if (ALLOWED_RESOLUTIONS.has(upper)) return upper;
  if (/^1080P?$/i.test(trimmed)) return '1080P';
  if (/^720P?$/i.test(trimmed)) return '720P';

  return inferResolutionFromDimensions(trimmed);
}

function parseSize(
  size?: string,
  params?: Record<string, unknown>
): {
  resolution: string;
  ratio: string;
} {
  const rawSize = size?.trim();
  const [sizeResolution, sizeRatio] = rawSize?.split('@') || [];
  const resolution =
    normalizeResolution(params?.resolution as string | undefined) ||
    normalizeResolution(sizeResolution) ||
    '1080P';
  const ratio =
    normalizeRatio(params?.ratio as string | undefined) ||
    normalizeRatio(params?.aspect_ratio as string | undefined) ||
    normalizeRatio(params?.aspectRatio as string | undefined) ||
    normalizeRatio(sizeRatio) ||
    inferRatioFromDimensions(sizeResolution || '') ||
    '16:9';

  return { resolution, ratio };
}

function parseIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  fieldName: string
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} 必须是 ${min}~${max} 的整数`);
  }

  return parsed;
}

function parseDuration(request: VideoGenerationRequest): number {
  const explicitDuration = Number.isFinite(request.duration)
    ? request.duration
    : undefined;
  return (
    parseIntegerInRange(explicitDuration, 3, 15, 'HappyHorse 视频时长') ||
    parseIntegerInRange(
      request.params?.duration,
      3,
      15,
      'HappyHorse 视频时长'
    ) ||
    5
  );
}

function parseWatermark(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (typeof value === 'boolean') return value;
  return String(value).trim().toLowerCase() !== 'false';
}

function parseAudioSetting(value: unknown): 'auto' | 'origin' {
  return value === 'origin' ? 'origin' : 'auto';
}

function buildParameters(
  model: string,
  request: VideoGenerationRequest
): HappyHorseVideoParameters {
  const { resolution, ratio } = parseSize(request.size, request.params);
  const parameters: HappyHorseVideoParameters = {
    resolution,
    watermark: parseWatermark(request.params?.watermark),
  };

  const seed = parseIntegerInRange(
    request.params?.seed,
    0,
    2147483647,
    'HappyHorse seed'
  );
  if (seed !== undefined) {
    parameters.seed = seed;
  }

  if (model === HAPPYHORSE_EDIT_MODEL_ID) {
    parameters.audio_setting = parseAudioSetting(request.params?.audio_setting);
    return parameters;
  }

  parameters.duration = parseDuration(request);
  if (HAPPYHORSE_RATIO_MODEL_IDS.has(model)) {
    parameters.ratio = ratio;
  }

  return parameters;
}

async function normalizeImageInput(url: string): Promise<string> {
  const imageData = await unifiedCacheService.getImageForAI(url);
  return ensureBase64ForAI(imageData);
}

async function normalizeImageInputs(urls?: string[]): Promise<string[]> {
  if (!urls?.length) return [];
  const images: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    images.push(await normalizeImageInput(url));
  }
  return images;
}

function getStringParam(
  params: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = params?.[key];
    if (Array.isArray(value)) {
      const firstValue = value.find(
        (item): item is string => typeof item === 'string' && !!item.trim()
      );
      if (firstValue) {
        return firstValue.trim();
      }
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getStringArrayParam(
  params: Record<string, unknown> | undefined,
  keys: string[]
): string[] {
  for (const key of keys) {
    const value = params?.[key];
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
  }
  return [];
}

function extractTaskId(response: HappyHorseTaskResponse): string {
  const taskId = response.task_id || response.id;
  if (!taskId) {
    throw new Error('HappyHorse API 未返回任务 ID');
  }
  return taskId;
}

function extractErrorMessage(
  error?: HappyHorseTaskResponse['error'],
  fallback = 'HappyHorse 视频生成失败'
): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || fallback;
}

async function readErrorResponse(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `${response.status}`;
  try {
    const data = JSON.parse(text);
    return (
      (typeof data?.error === 'string' ? data.error : data?.error?.message) ||
      data?.message ||
      text
    );
  } catch {
    return text;
  }
}

async function submitHappyHorseVideo(
  context: AdapterContext,
  request: VideoGenerationRequest
): Promise<HappyHorseTaskResponse> {
  const model = request.model || 'happyhorse-1.0-t2v';
  const referenceImages = await normalizeImageInputs(request.referenceImages);
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    parameters: buildParameters(model, request),
  };

  if (model === 'happyhorse-1.0-i2v') {
    const imageParam = getStringParam(request.params, [
      'image',
      'input_reference',
    ]);
    const image = imageParam
      ? await normalizeImageInput(imageParam)
      : referenceImages[0];
    if (!image) {
      throw new Error('HappyHorse I2V 需要首帧图片');
    }
    body.image = image;
  } else if (model === 'happyhorse-1.0-r2v') {
    const paramImages = await normalizeImageInputs(
      getStringArrayParam(request.params, ['input_reference', 'images'])
    );
    const images = (referenceImages.length > 0 ? referenceImages : paramImages)
      .slice(0, 9);
    const inputReferenceParam = getStringParam(request.params, [
      'input_reference',
      'image',
    ]);
    const inputReference = inputReferenceParam
      ? await normalizeImageInput(inputReferenceParam)
      : undefined;
    if (images.length > 0) {
      body.images = images;
    } else if (inputReference) {
      body.images = [inputReference];
    } else {
      throw new Error('HappyHorse R2V 需要至少 1 张参考图');
    }
  } else if (model === HAPPYHORSE_EDIT_MODEL_ID) {
    const video = getStringParam(request.params, [
      'video',
      'input_video',
      'reference_video',
    ]);
    if (!video) {
      throw new Error('HappyHorse Video Edit 需要 input_video 视频 URL');
    }
    body.video = video;
    const imageParam = getStringParam(request.params, [
      'image',
      'input_reference',
    ]);
    const editImage =
      referenceImages[0] ||
      (imageParam ? await normalizeImageInput(imageParam) : undefined);
    if (editImage) {
      body.image = editImage;
    }
  }

  const response = await sendAdapterRequest(context, {
    path: context.binding?.submitPath || '/videos',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `HappyHorse 视频提交失败: ${await readErrorResponse(response)}`
    );
  }

  return response.json();
}

function resolvePollPath(context: AdapterContext, taskId: string): string {
  const template = context.binding?.pollPathTemplate || '/videos/{taskId}';
  return template.replace(/\{taskId\}/g, encodeURIComponent(taskId));
}

async function queryHappyHorseVideo(
  context: AdapterContext,
  taskId: string
): Promise<HappyHorseTaskResponse> {
  const response = await sendAdapterRequest(context, {
    path: resolvePollPath(context, taskId),
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(
      `HappyHorse 状态查询失败: ${await readErrorResponse(response)}`
    );
  }

  return response.json();
}

async function resolveHappyHorseResultUrl(
  context: AdapterContext,
  taskId: string,
  model: string,
  status: HappyHorseTaskResponse
): Promise<string> {
  const inlineUrl = status.url || status.video_url;
  if (inlineUrl) {
    return inlineUrl;
  }

  return downloadVideoContentToLocalUrl({
    videoId: taskId,
    provider: buildProviderContextFromAdapterContext(context),
    binding: context.binding,
    modelId: model,
    cacheKey: taskId,
  });
}

export const happyHorseVideoAdapter: VideoModelAdapter = {
  id: 'happyhorse-video-adapter',
  label: 'HappyHorse Video',
  kind: 'video',
  matchProtocols: ['happyhorse.video'],
  matchRequestSchemas: ['happyhorse.video.json'],
  matchTags: ['happyhorse'],
  matchPredicate(modelConfig) {
    return modelConfig.type === 'video' && isHappyHorseModelId(modelConfig.id);
  },
  supportedModels: HAPPYHORSE_MODELS,
  defaultModel: 'happyhorse-1.0-t2v',

  async generateVideo(context, request: VideoGenerationRequest) {
    const model = request.model || 'happyhorse-1.0-t2v';
    const onProgress = request.params?.onProgress as
      | ((progress: number, status?: string) => void)
      | undefined;
    const onSubmitted = request.params?.onSubmitted as
      | ((videoId: string) => void | Promise<void>)
      | undefined;

    onProgress?.(5, 'submitting');

    const submitResult = await submitHappyHorseVideo(context, request);
    const taskId = extractTaskId(submitResult);
    await onSubmitted?.(taskId);

    if (submitResult.status === 'failed' || submitResult.status === 'error') {
      throw new Error(extractErrorMessage(submitResult.error));
    }

    onProgress?.(10, submitResult.status || 'processing');

    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10;

    while (attempts < DEFAULT_POLL_MAX_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS)
      );
      attempts += 1;

      let isBusinessFailure = false;
      try {
        const status = await queryHappyHorseVideo(context, taskId);
        consecutiveErrors = 0;

        const progress =
          status.progress ??
          (status.status === 'completed' || status.status === 'succeeded'
            ? 100
            : status.status === 'failed' || status.status === 'error'
            ? 100
            : 0);
        onProgress?.(progress, status.status || 'processing');

        if (status.status === 'completed' || status.status === 'succeeded') {
          const url = await resolveHappyHorseResultUrl(
            context,
            taskId,
            model,
            status
          );
          return {
            url,
            format: 'mp4',
            duration: request.duration,
            raw: status,
          };
        }

        if (status.status === 'failed' || status.status === 'error') {
          isBusinessFailure = true;
          throw new Error(extractErrorMessage(status.error));
        }
      } catch (err: unknown) {
        if (isBusinessFailure) {
          throw err;
        }

        consecutiveErrors++;
        const message = err instanceof Error ? err.message : err;
        console.warn(
          `[HappyHorse] Status query failed, attempt ${consecutiveErrors}/${maxConsecutiveErrors}:`,
          message
        );

        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw err;
        }

        const backoffInterval = Math.min(
          DEFAULT_POLL_INTERVAL_MS * Math.pow(1.5, consecutiveErrors),
          60000
        );
        await new Promise((resolve) =>
          setTimeout(resolve, backoffInterval - DEFAULT_POLL_INTERVAL_MS)
        );
      }
    }

    throw new Error('HappyHorse 视频生成超时');
  },
};

export const registerHappyHorseAdapter = (): void => {
  registerModelAdapter(happyHorseVideoAdapter);
};
