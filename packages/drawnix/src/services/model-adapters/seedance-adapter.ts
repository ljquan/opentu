import type {
  AdapterContext,
  VideoGenerationRequest,
  VideoModelAdapter,
} from './types';
import { registerModelAdapter } from './registry';
import { sendAdapterRequest } from './context';
import { readProviderResponseText } from '../provider-routing';

const SEEDANCE_MODELS = [
  'seedance-1.5-pro',
  'seedance-1.0-pro',
  'seedance-1.0-pro-fast',
  'seedance-1.0-lite',
];

export const isLegacySeedanceModel = (modelId: string): boolean =>
  SEEDANCE_MODELS.includes(modelId);

type SeedanceSubmitResponse = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at?: number;
  error?: string | { code: string; message: string };
};

type SeedanceQueryResponse = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  video_url?: string;
  url?: string;
  seconds?: string;
  error?: string | { code: string; message: string };
};

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_MAX_ATTEMPTS = 1080; // ~90 min
const PHYSICAL_SEEDANCE_MODEL_PATTERN =
  /^doubao-seedance-(1-5-pro|1-0-pro(?:-fast)?|1-0-lite)_(480p|720p|1080p)$/i;

type PhysicalSeedanceModel = {
  modelId: string;
  family:
    | 'seedance-1.5-pro'
    | 'seedance-1.0-pro'
    | 'seedance-1.0-pro-fast'
    | 'seedance-1.0-lite';
  resolution: string;
};

const parsePhysicalSeedanceModel = (
  modelId: string
): PhysicalSeedanceModel | undefined => {
  const match = modelId.match(PHYSICAL_SEEDANCE_MODEL_PATTERN);
  if (!match) return undefined;

  const family =
    match[1].toLowerCase() === '1-5-pro'
      ? 'seedance-1.5-pro'
      : match[1].toLowerCase() === '1-0-pro-fast'
      ? 'seedance-1.0-pro-fast'
      : match[1].toLowerCase() === '1-0-lite'
      ? 'seedance-1.0-lite'
      : 'seedance-1.0-pro';
  return { modelId, family, resolution: match[2].toLowerCase() };
};

/**
 * 将逻辑模型 ID + 分辨率拼接为 API 实际模型名
 * seedance-1.5-pro + 720p → doubao-seedance-1-5-pro_720p
 */
const resolveActualModel = (logicalId: string, resolution: string): string => {
  if (parsePhysicalSeedanceModel(logicalId)) {
    return logicalId;
  }

  // 将 "." 替换为 "-"：seedance-1.5-pro → seedance-1-5-pro
  const normalized = logicalId.replace(/\./g, '-');
  return `doubao-${normalized}_${resolution}`;
};

const isSeedanceLiteModel = (modelId: string): boolean =>
  (parsePhysicalSeedanceModel(modelId)?.family || modelId) ===
  'seedance-1.0-lite';

const normalizeAspectRatio = (aspectRatio?: string): string | undefined => {
  const normalized = aspectRatio?.trim().replace(/[xX]/g, ':');
  return normalized && /^\d+:\d+$/.test(normalized) ? normalized : undefined;
};

const parseSeedanceSize = (
  size?: string
): { resolution?: string; aspectRatio?: string } => {
  if (!size) {
    return {};
  }
  const [resolution, rawAspectRatio] = size.split('@');
  return {
    resolution: /^\d+p$/.test(resolution) ? resolution : undefined,
    aspectRatio: normalizeAspectRatio(rawAspectRatio),
  };
};

/**
 * 从 size 参数提取分辨率（480p/720p/1080p）
 */
const extractResolution = (size?: string): string => {
  return parseSeedanceSize(size).resolution || '720p';
};

const resolveBaseUrl = (context: AdapterContext): string => {
  if (!context.baseUrl) {
    throw new Error('Missing baseUrl for Seedance adapter');
  }
  return context.baseUrl.replace(/\/$/, '');
};

const extractErrorMessage = (
  error?: string | { code?: string; message?: string },
  fallback = '视频生成失败'
): string => {
  if (!error) return fallback;
  if (typeof error === 'string') return error.trim() || fallback;
  return error.message?.trim() || error.code?.trim() || fallback;
};

const truncateErrorText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, 1000);

type SeedanceErrorPayload = {
  error?: string | { code?: string; message?: string };
  message?: string;
  detail?: string;
  code?: string;
};

async function readSeedanceError(
  response: Response,
  operation: 'submit' | 'query'
): Promise<Error> {
  const rawText = await readProviderResponseText(response).catch(() => '');
  let parsed: SeedanceErrorPayload | null = null;
  try {
    parsed = rawText.trim()
      ? (JSON.parse(rawText) as SeedanceErrorPayload)
      : null;
  } catch {
    // Preserve non-JSON provider diagnostics below.
  }

  const requestId =
    response.headers.get('x-request-id') ||
    response.headers.get('request-id') ||
    response.headers.get('x-correlation-id');
  const bodyMessage = parsed
    ? extractErrorMessage(
        parsed.error,
        parsed.message || parsed.detail || parsed.code || ''
      )
    : truncateErrorText(rawText);
  const message =
    bodyMessage || `Seedance ${operation} failed: HTTP ${response.status}`;
  const withRequestId = requestId
    ? `${message} (request id: ${truncateErrorText(requestId)})`
    : message;
  const error = new Error(withRequestId);
  Object.assign(error, {
    httpStatus: response.status,
    upstreamCode: parsed?.code,
    requestId: requestId || undefined,
  });
  return error;
}

/**
 * 将 base64 data URL 或远程 URL 转为 Blob
 */
const urlToBlob = async (url: string): Promise<Blob> => {
  const response = await fetch(url);
  return response.blob();
};

/**
 * 提交 Seedance 视频生成任务
 */
const submitSeedanceVideo = async (
  context: AdapterContext,
  params: {
    model: string;
    prompt: string;
    seconds?: string;
    size?: string;
    firstFrameImage?: string;
    lastFrameImage?: string;
    inputReferences?: string[];
  }
): Promise<SeedanceSubmitResponse> => {
  const baseUrl = resolveBaseUrl(context);

  const formData = new FormData();
  formData.append('model', params.model);
  formData.append('prompt', params.prompt);

  if (params.seconds) {
    formData.append('seconds', params.seconds);
  }

  if (params.size) {
    formData.append('size', params.size);
  }

  // 首帧图
  if (params.firstFrameImage) {
    const blob = await urlToBlob(params.firstFrameImage);
    formData.append('first_frame_image', blob, 'first_frame.png');
  }

  // 尾帧图
  if (params.lastFrameImage) {
    const blob = await urlToBlob(params.lastFrameImage);
    formData.append('last_frame_image', blob, 'last_frame.png');
  }

  // 参考图（lite 模型，1-4 张）
  if (params.inputReferences && params.inputReferences.length > 0) {
    for (const ref of params.inputReferences) {
      const blob = await urlToBlob(ref);
      formData.append('input_reference', blob, 'reference.png');
    }
  }

  const response = await sendAdapterRequest(
    context,
    {
      path: '/videos',
      method: 'POST',
      body: formData,
    },
    baseUrl
  );

  if (!response.ok) {
    throw await readSeedanceError(response, 'submit');
  }

  return JSON.parse(await readProviderResponseText(response));
};

/**
 * 查询 Seedance 视频生成状态
 */
const querySeedanceVideo = async (
  context: AdapterContext,
  taskId: string
): Promise<SeedanceQueryResponse> => {
  const baseUrl = resolveBaseUrl(context);
  const response = await sendAdapterRequest(
    context,
    {
      path: `/videos/${taskId}`,
      method: 'GET',
    },
    baseUrl
  );

  if (!response.ok) {
    throw await readSeedanceError(response, 'query');
  }

  return JSON.parse(await readProviderResponseText(response));
};

export const seedanceVideoAdapter: VideoModelAdapter = {
  id: 'seedance-video-adapter',
  label: 'Seedance Video',
  kind: 'video',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['seedance.task'],
  matchRequestSchemas: ['seedance.video.form-auto'],
  supportedModels: SEEDANCE_MODELS,
  matchPredicate(modelConfig) {
    return isLegacySeedanceModel(modelConfig.id);
  },
  defaultModel: 'seedance-1.5-pro',

  async generateVideo(context, request: VideoGenerationRequest) {
    const logicalModel = request.model || 'seedance-1.5-pro';
    const physicalModel = parsePhysicalSeedanceModel(logicalModel);
    if (
      logicalModel.toLowerCase().startsWith('doubao-seedance-') &&
      !physicalModel
    ) {
      throw new Error(`不支持的 Seedance 物理模型：${logicalModel}`);
    }
    const resolution =
      physicalModel?.resolution || extractResolution(request.size);
    const actualModel = resolveActualModel(logicalModel, resolution);
    const parsedSize = parseSeedanceSize(request.size);

    // 宽高比优先取显式参数，其次回退到 size 中的组合值
    const aspectRatio =
      normalizeAspectRatio(
        request.params?.aspect_ratio as string | undefined
      ) ||
      normalizeAspectRatio(request.params?.aspectRatio as string | undefined) ||
      parsedSize.aspectRatio ||
      '16:9';

    // 首帧/尾帧：referenceImages[0] = 首帧, referenceImages[1] = 尾帧
    const firstFrameImage = request.referenceImages?.[0];
    const lastFrameImage = request.referenceImages?.[1];

    // 参考图（lite 模型）：所有图片作为 input_reference
    const isLite =
      physicalModel?.family === 'seedance-1.0-lite' ||
      isSeedanceLiteModel(logicalModel);
    const inputReferences = isLite ? request.referenceImages : undefined;

    const onProgress = request.params?.onProgress as
      | ((progress: number, status?: string) => void)
      | undefined;
    const onSubmitted = request.params?.onSubmitted as
      | ((videoId: string) => void)
      | undefined;

    onProgress?.(5, 'submitting');

    const submitResult = await submitSeedanceVideo(context, {
      model: actualModel,
      prompt: request.prompt,
      seconds: request.duration ? String(request.duration) : '5',
      size: aspectRatio,
      firstFrameImage: isLite ? undefined : firstFrameImage,
      lastFrameImage: isLite ? undefined : lastFrameImage,
      inputReferences,
    });

    const taskId = submitResult.id;
    if (!taskId) {
      throw new Error('Seedance API 未返回任务 ID');
    }

    onSubmitted?.(taskId);

    // 提交时已失败
    if (submitResult.status === 'failed') {
      throw new Error(extractErrorMessage(submitResult.error));
    }

    onProgress?.(10, 'processing');

    // 轮询
    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10;

    while (attempts < DEFAULT_POLL_MAX_ATTEMPTS) {
      context.signal?.throwIfAborted();
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS)
      );
      context.signal?.throwIfAborted();
      attempts += 1;

      let isBusinessFailure = false;

      try {
        const status = await querySeedanceVideo(context, taskId);
        consecutiveErrors = 0;

        const progress =
          status.progress ??
          (status.status === 'failed'
            ? 100
            : status.status === 'completed'
            ? 100
            : 0);
        onProgress?.(progress, status.status);

        if (status.status === 'completed') {
          const url = status.video_url || status.url;
          if (!url) {
            throw new Error('Seedance 结果缺少视频 URL');
          }
          return {
            url,
            format: 'mp4',
            duration: status.seconds ? parseInt(status.seconds, 10) : undefined,
            raw: status,
          };
        }

        if (status.status === 'failed') {
          isBusinessFailure = true;
          throw new Error(extractErrorMessage(status.error));
        }
      } catch (err: any) {
        if (context.signal?.aborted) {
          context.signal.throwIfAborted();
        }
        if (isBusinessFailure) {
          throw err;
        }

        consecutiveErrors++;
        console.warn(
          `[Seedance] Status query failed, attempt ${consecutiveErrors}/${maxConsecutiveErrors}:`,
          err?.message || err
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
        context.signal?.throwIfAborted();
      }
    }

    throw new Error('Seedance 视频生成超时');
  },
};

export const registerSeedanceAdapter = (): void => {
  registerModelAdapter(seedanceVideoAdapter);
};
