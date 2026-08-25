import type {
  AdapterContext,
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoModelAdapter,
} from './types';
import { registerModelAdapter } from './registry';
import { buildProviderContextFromAdapterContext } from './context';
import { providerTransport } from '../provider-routing';
import {
  areSeedanceAudioDataUrlsWithinLimit,
  downloadVideoContentToLocalUrl,
  extractInlineVideoUrl,
  isSeedanceAudioReference,
  isPublicHttpMediaUrl,
} from '../video-binding-utils';
import { unifiedCacheService } from '../unified-cache-service';
import {
  isVirtualMediaUrl,
  SEEDANCE_AUDIO_DATA_URL_MAX_LENGTH,
} from '../../utils/virtual-media-url';
import {
  getSeedance2Capabilities,
  getSeedance2Label,
  isSeedance25ModelId,
  isSeedance2ModelId,
  normalizeSeedanceRatio,
  SEEDANCE_2_RESOLUTIONS,
} from '../../utils/seedance-model';

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_ERRORS = 10;
const MAX_POLL_ATTEMPTS = 1080;

interface Seedance2ContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  role?:
    | 'first_frame'
    | 'last_frame'
    | 'reference_image'
    | 'reference_video'
    | 'reference_audio';
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
}

interface Seedance2TaskResponse {
  id?: string;
  task_id?: string;
  model?: string;
  status?: string;
  progress?: number;
  duration?: number;
  seconds?: string;
  video_url?: string;
  url?: string;
  content?: { video_url?: string; url?: string };
  output?: { url?: string };
  metadata?: { url?: string; video_url?: string };
  message?: string;
  error?: string | { message?: string };
}

class Seedance2HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'Seedance2HttpError';
  }
}

function isSeedance2Model(modelId: string): boolean {
  return isSeedance2ModelId(modelId);
}

function parseLegacySize(size?: string): {
  resolution: string;
  ratio: string;
} {
  const normalizedSize = size?.trim().toLowerCase() || '720p@16:9';
  if (/^\d+\s*[x:]\s*\d+$/.test(normalizedSize)) {
    return {
      resolution: '720p',
      ratio: normalizeSeedanceRatio(normalizedSize) || '16:9',
    };
  }
  if (normalizedSize === 'auto' || normalizedSize === 'adaptive') {
    return { resolution: '720p', ratio: 'adaptive' };
  }
  const [rawResolution, rawRatio] = normalizedSize.split('@');
  return {
    resolution: rawResolution || '720p',
    ratio: normalizeSeedanceRatio(rawRatio) || '16:9',
  };
}

function parseBoolean(
  value: unknown,
  fallback: boolean,
  label: string,
  modelLabel = 'Seedance 2.0'
): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  throw new Error(`${modelLabel} ${label}必须为布尔值`);
}

function parseOptionalBoolean(
  value: unknown,
  label: string,
  modelLabel = 'Seedance 2.0'
) {
  if (value === undefined || value === null || value === '') return undefined;
  return parseBoolean(value, false, label, modelLabel);
}

function parseOptionalInteger(
  value: unknown,
  label: string,
  modelLabel = 'Seedance 2.0'
) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${modelLabel} ${label}必须为整数`);
  }
  return parsed;
}

function resolveVideoOptions(
  request: VideoGenerationRequest,
  capabilities: NonNullable<ReturnType<typeof getSeedance2Capabilities>>,
  modelLabel: string
): {
  resolution: string;
  ratio: string;
  duration: number;
} {
  const legacy = parseLegacySize(request.size);
  const resolution =
    getStringParam(request.params, ['resolution']) || legacy.resolution;
  const ratio =
    normalizeSeedanceRatio(
      getStringParam(request.params, ['ratio', 'aspect_ratio'])
    ) || legacy.ratio;
  const duration = request.duration ?? capabilities.defaultDuration;

  if (
    !SEEDANCE_2_RESOLUTIONS.includes(
      resolution as (typeof SEEDANCE_2_RESOLUTIONS)[number]
    )
  ) {
    throw new Error(`${modelLabel} 不支持的分辨率：${resolution}`);
  }
  if (!capabilities.ratios.includes(ratio)) {
    throw new Error(`${modelLabel} 不支持的宽高比：${ratio}`);
  }
  if (
    !Number.isInteger(duration) ||
    duration < capabilities.minDuration ||
    duration > capabilities.maxDuration
  ) {
    throw new Error(
      `${modelLabel} 视频时长必须为 ${capabilities.minDuration}-${capabilities.maxDuration} 秒整数`
    );
  }

  return { resolution, ratio, duration };
}

function extractErrorMessage(error: Seedance2TaskResponse['error']): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (
    error &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }
  return 'Seedance 2.0 视频生成失败';
}

function extractResultUrl(response: Seedance2TaskResponse): string | undefined {
  return (
    extractInlineVideoUrl(response as Record<string, unknown>) ||
    response.content?.video_url ||
    response.content?.url ||
    response.metadata?.video_url ||
    response.metadata?.url
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Video generation cancelled'));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Video generation cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function getStringParam(
  params: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getStringArrayParam(
  params: Record<string, unknown> | undefined,
  key: string,
  label: string,
  maxCount: number,
  modelLabel = 'Seedance 2.0'
): string[] {
  const value = params?.[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${modelLabel} ${label}必须为字符串数组`);
  }
  if (value.length > maxCount) {
    throw new Error(`${modelLabel} ${label}最多支持 ${maxCount} 条`);
  }

  const normalizedValues: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(
        `${modelLabel} 第 ${index + 1} 条${label}必须为非空字符串`
      );
    }
    normalizedValues.push(item);
  }
  return normalizedValues;
}

function normalizeReferenceVideoUrl(
  value: string,
  label = '参考视频',
  modelLabel = 'Seedance 2.0'
): string {
  const normalized = value.trim();
  if (!isPublicHttpMediaUrl(normalized)) {
    throw new Error(`${modelLabel} ${label}仅支持公网 HTTP(S) 地址`);
  }
  return normalized;
}

function normalizeReferenceAudio(
  value: string,
  label = '参考音频',
  modelLabel = 'Seedance 2.0'
): string {
  const normalized = value.trim();
  if (!isSeedanceAudioReference(normalized)) {
    throw new Error(
      `${modelLabel} ${label}仅支持 HTTP(S)、asset://、音频 Data URL 或素材 ID`
    );
  }
  return normalized;
}

function resolveReferences(
  request: VideoGenerationRequest,
  options: {
    arrayKey: string;
    singleKeys: string[];
    label: string;
    maxCount: number;
    modelLabel: string;
    normalize: (value: string, label: string, modelLabel: string) => string;
    validateCandidates?: (values: readonly string[]) => void;
  }
): string[] {
  const arrayValues = getStringArrayParam(
    request.params,
    options.arrayKey,
    options.label,
    options.maxCount,
    options.modelLabel
  );
  const singleValue = getStringParam(request.params, options.singleKeys);
  const candidates = singleValue ? [singleValue, ...arrayValues] : arrayValues;
  const references: string[] = [];
  const seen = new Set<string>();
  options.validateCandidates?.([
    ...new Set(candidates.map((value) => value.trim())),
  ]);

  candidates.forEach((value, index) => {
    const normalized = options.normalize(
      value,
      candidates.length > 1
        ? `第 ${index + 1} 条${options.label}`
        : options.label,
      options.modelLabel
    );
    if (seen.has(normalized)) return;
    seen.add(normalized);
    references.push(normalized);
  });

  if (references.length > options.maxCount) {
    throw new Error(
      `${options.modelLabel} ${options.label}最多支持 ${options.maxCount} 条`
    );
  }
  return references;
}

function getProjectedAudioDataUrlLength(blob: Blob): number {
  return `data:${blob.type};base64,`.length + Math.ceil(blob.size / 3) * 4;
}

async function blobToDataUrlAtRequestTime(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    const { blobToDataUrl } = await import('@aitu/utils');
    return blobToDataUrl(blob);
  }

  if (typeof blob.arrayBuffer !== 'function' || typeof btoa !== 'function') {
    throw new Error('Seedance 2.0 本地参考音频转换失败');
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    );
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function buildContent(
  request: VideoGenerationRequest,
  capabilities: NonNullable<ReturnType<typeof getSeedance2Capabilities>>,
  modelLabel: string
): Promise<Seedance2ContentItem[]> {
  if ((request.referenceImages || []).length > capabilities.maxReferenceImages) {
    throw new Error(
      `${modelLabel} 参考图片最多支持 ${capabilities.maxReferenceImages} 张`
    );
  }
  const content: Seedance2ContentItem[] = [
    { type: 'text', text: request.prompt },
    ...(request.referenceImages || []).map((url) => ({
      type: 'image_url' as const,
      image_url: { url },
      role: 'reference_image' as const,
    })),
  ];

  const videoUrls = resolveReferences(request, {
    arrayKey: 'input_videos',
    singleKeys: ['input_video', 'reference_video'],
    label: '参考视频',
    maxCount: capabilities.maxReferenceVideos,
    modelLabel,
    normalize: (value, label, currentModelLabel) =>
      normalizeReferenceVideoUrl(value, label, currentModelLabel),
  });
  videoUrls.forEach((videoUrl) => {
    content.push({
      type: 'video_url',
      video_url: { url: videoUrl },
      role: 'reference_video',
    });
  });

  const audioUrls = resolveReferences(request, {
    arrayKey: 'input_audios',
    singleKeys: ['input_audio', 'reference_audio'],
    label: '参考音频',
    maxCount: capabilities.maxReferenceAudios,
    modelLabel,
    normalize: (value, label, currentModelLabel) =>
      normalizeReferenceAudio(value, label, currentModelLabel),
    validateCandidates: (values) => {
      if (!areSeedanceAudioDataUrlsWithinLimit(values)) {
        throw new Error(`${modelLabel} 音频 Data URL 合计不能超过 16 MiB`);
      }
    },
  });
  let projectedAudioDataUrlLength = audioUrls.reduce(
    (total, audioUrl) =>
      audioUrl.trim().startsWith('data:audio/')
        ? total + audioUrl.trim().length
        : total,
    0
  );
  const virtualAudioBlobs = new Map<string, Blob>();
  for (const audioUrl of audioUrls) {
    if (!isVirtualMediaUrl(audioUrl)) continue;

    const blob = await unifiedCacheService.getCachedBlob(audioUrl);
    if (
      !blob ||
      blob.size === 0 ||
      !blob.type.toLowerCase().startsWith('audio/')
    ) {
    throw new Error(`${modelLabel} 本地参考音频缓存不可用`);
    }
    projectedAudioDataUrlLength += getProjectedAudioDataUrlLength(blob);
    if (projectedAudioDataUrlLength > SEEDANCE_AUDIO_DATA_URL_MAX_LENGTH) {
      throw new Error(`${modelLabel} 音频 Data URL 合计不能超过 16 MiB`);
    }
    virtualAudioBlobs.set(audioUrl, blob);
  }

  const materializedAudioUrls: string[] = [];
  for (const audioUrl of audioUrls) {
    const blob = virtualAudioBlobs.get(audioUrl);
    if (!blob) {
      materializedAudioUrls.push(audioUrl);
      continue;
    }
    materializedAudioUrls.push(await blobToDataUrlAtRequestTime(blob));
    virtualAudioBlobs.delete(audioUrl);
  }
  if (!areSeedanceAudioDataUrlsWithinLimit(materializedAudioUrls)) {
    throw new Error(`${modelLabel} 音频 Data URL 合计不能超过 16 MiB`);
  }
  materializedAudioUrls.forEach((audioUrl) => {
    content.push({
      type: 'audio_url',
      audio_url: { url: audioUrl },
      role: 'reference_audio',
    });
  });

  return content;
}

async function readJsonResponse(
  response: Response,
  action: string
): Promise<Seedance2TaskResponse> {
  const body = (await response
    .json()
    .catch(() => null)) as Seedance2TaskResponse | null;
  if (!response.ok) {
    throw new Seedance2HttpError(
      body?.error
        ? extractErrorMessage(body.error)
        : body?.message?.trim()
        ? body.message
        : `${action}失败：HTTP ${response.status}`,
      response.status
    );
  }
  return body || {};
}

function isTransientPollError(error: unknown): boolean {
  if (!(error instanceof Seedance2HttpError)) return true;
  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export const seedance2VideoAdapter: VideoModelAdapter = {
  id: 'seedance-2-video-adapter',
  label: 'Seedance 2.0 Video',
  kind: 'video',
  docsUrl: 'https://tuzi-api.apifox.cn/418534831e0',
  matchProtocols: ['openai.async.video'],
  matchRequestSchemas: ['doubao.seedance-2.video.content-json'],
  matchPredicate(modelConfig) {
    return isSeedance2Model(modelConfig.id);
  },

  async generateVideo(
    context: AdapterContext,
    request: VideoGenerationRequest
  ): Promise<VideoGenerationResult> {
    const model = request.model || '';
    if (!isSeedance2Model(model)) {
      throw new Error(`不支持的 Seedance 2.0 模型：${model}`);
    }

    const capabilities = getSeedance2Capabilities(model);
    if (!capabilities) {
      throw new Error(`不支持的 Seedance 2.0 模型：${model}`);
    }
    const modelLabel = getSeedance2Label(model);
    const provider = buildProviderContextFromAdapterContext(context);
    const { resolution, ratio, duration } = resolveVideoOptions(
      request,
      capabilities,
      modelLabel
    );
    const seed = capabilities.supportsAdvancedControls
      ? parseOptionalInteger(request.params?.seed, '随机种子', modelLabel)
      : undefined;
    const cameraFixed = capabilities.supportsAdvancedControls
      ? parseOptionalBoolean(
          request.params?.camera_fixed,
          '固定镜头',
          modelLabel
        )
      : undefined;
    const onProgress = request.params?.onProgress as
      | ((progress: number, status?: string) => void)
      | undefined;
    const onSubmitted = request.params?.onSubmitted as
      | ((taskId: string) => void)
      | undefined;

    const submitBody = {
      model,
      content: await buildContent(request, capabilities, modelLabel),
      // Tuzi's current Seedance 2.5 endpoint does not declare resolution in
      // its request schema. Keep the legacy field for Seedance 2.0 only.
      ...(!isSeedance25ModelId(model) ? { resolution } : {}),
      ratio,
      duration,
      generate_audio: parseBoolean(
        request.params?.generate_audio,
        true,
        '生成音频',
        modelLabel
      ),
      watermark: parseBoolean(
        request.params?.watermark,
        false,
        '水印',
        modelLabel
      ),
      ...(seed !== undefined ? { seed } : {}),
      ...(cameraFixed !== undefined ? { camera_fixed: cameraFixed } : {}),
    };

    const submitResponse = await providerTransport.send(provider, {
      path: context.binding?.submitPath || '/videos',
      baseUrlStrategy: context.binding?.baseUrlStrategy,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitBody),
      signal: context.signal,
      fetcher: context.fetcher,
    });
    const submitted = await readJsonResponse(submitResponse, '视频提交');
    if (submitted.status?.toLowerCase() === 'failed') {
      throw new Error(extractErrorMessage(submitted.error));
    }
    const taskId = submitted.task_id || submitted.id;
    if (!taskId) {
      throw new Error('Seedance 2.0 API 未返回任务 ID');
    }

    onSubmitted?.(taskId);
    onProgress?.(5, submitted.status || 'queued');

    let consecutiveErrors = 0;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await sleep(DEFAULT_POLL_INTERVAL_MS, context.signal);

      let businessFailure = false;
      try {
        const pollResponse = await providerTransport.send(provider, {
          path: (
            context.binding?.pollPathTemplate || '/videos/{taskId}'
          ).replace('{taskId}', encodeURIComponent(taskId)),
          baseUrlStrategy: context.binding?.baseUrlStrategy,
          method: 'GET',
          signal: context.signal,
          fetcher: context.fetcher,
        });
        const status = await readJsonResponse(pollResponse, '视频状态查询');
        consecutiveErrors = 0;
        const normalizedStatus = (status.status || '').toLowerCase();
        onProgress?.(status.progress ?? 0, normalizedStatus);

        if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
          businessFailure = true;
          throw new Error(extractErrorMessage(status.error));
        }
        if (
          normalizedStatus === 'completed' ||
          normalizedStatus === 'succeeded'
        ) {
          const inlineUrl = extractResultUrl(status);
          const url =
            inlineUrl ||
            (await downloadVideoContentToLocalUrl({
              videoId: taskId,
              provider,
              binding: context.binding,
              modelId: status.model || model,
              cacheKey: taskId,
            }));
          onProgress?.(100, normalizedStatus);
          return {
            url,
            format: 'mp4',
            duration:
              status.duration ||
              (status.seconds ? parseInt(status.seconds, 10) : duration),
            raw: status,
          };
        }
      } catch (error) {
        if (businessFailure) {
          throw error;
        }
        if (!isTransientPollError(error)) {
          throw error;
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw error;
        }
        await sleep(
          Math.min(
            DEFAULT_POLL_INTERVAL_MS * Math.pow(1.5, consecutiveErrors),
            60000
          ) - DEFAULT_POLL_INTERVAL_MS,
          context.signal
        );
      }
    }

    throw new Error('Seedance 2.0 视频生成超时');
  },
};

export function registerSeedance2Adapter(): void {
  registerModelAdapter(seedance2VideoAdapter);
}
