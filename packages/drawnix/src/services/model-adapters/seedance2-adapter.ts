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
  downloadVideoContentToLocalUrl,
  extractInlineVideoUrl,
} from '../video-binding-utils';

const SEEDANCE_2_MODEL_PREFIX = 'doubao-seedance-2-0-';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_ERRORS = 10;
const MAX_POLL_ATTEMPTS = 1080;

interface Seedance2ContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  role?: 'reference_image' | 'reference_video' | 'reference_audio';
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
  error?: string | { message?: string };
}

class Seedance2HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'Seedance2HttpError';
  }
}

function isSeedance2Model(modelId: string): boolean {
  return modelId.toLowerCase().startsWith(SEEDANCE_2_MODEL_PREFIX);
}

function parseSize(size?: string): { resolution: string; ratio: string } {
  const [rawResolution, rawRatio] = (size || '720p@16:9').split('@');
  return {
    resolution: rawResolution === '4K' ? '4k' : rawResolution || '720p',
    ratio: rawRatio || '16:9',
  };
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
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

function buildContent(request: VideoGenerationRequest): Seedance2ContentItem[] {
  const content: Seedance2ContentItem[] = [
    { type: 'text', text: request.prompt },
    ...(request.referenceImages || []).map((url) => ({
      type: 'image_url' as const,
      image_url: { url },
      role: 'reference_image' as const,
    })),
  ];

  const videoUrl = getStringParam(request.params, [
    'input_video',
    'reference_video',
  ]);
  if (videoUrl) {
    content.push({
      type: 'video_url',
      video_url: { url: videoUrl },
      role: 'reference_video',
    });
  }

  const audioUrl = getStringParam(request.params, [
    'input_audio',
    'reference_audio',
  ]);
  if (audioUrl) {
    content.push({
      type: 'audio_url',
      audio_url: { url: audioUrl },
      role: 'reference_audio',
    });
  }

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
  docsUrl: 'https://tuzi-api.apifox.cn/359269497e0',
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

    const provider = buildProviderContextFromAdapterContext(context);
    const { resolution, ratio } = parseSize(request.size);
    const duration = request.duration || 5;
    const onProgress = request.params?.onProgress as
      | ((progress: number, status?: string) => void)
      | undefined;
    const onSubmitted = request.params?.onSubmitted as
      | ((taskId: string) => void)
      | undefined;

    const submitResponse = await providerTransport.send(provider, {
      path: context.binding?.submitPath || '/videos',
      baseUrlStrategy: context.binding?.baseUrlStrategy,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        content: buildContent(request),
        resolution,
        ratio,
        duration,
        generate_audio: parseBoolean(request.params?.generate_audio, true),
        watermark: parseBoolean(request.params?.watermark, false),
      }),
      signal: context.signal,
      fetcher: context.fetcher,
    });
    const submitted = await readJsonResponse(submitResponse, '视频提交');
    const taskId = submitted.task_id || submitted.id;
    if (!taskId) {
      throw new Error('Seedance 2.0 API 未返回任务 ID');
    }
    if (submitted.status?.toLowerCase() === 'failed') {
      throw new Error(extractErrorMessage(submitted.error));
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
