import type {
  AdapterContext,
  VideoGenerationRequest,
  VideoModelAdapter,
} from './types';
import { registerModelAdapter } from './registry';
import { sendAdapterRequest } from './context';

const SEEDANCE_MODELS = [
  'seedance-1.5-pro',
  'seedance-1.0-pro',
  'seedance-1.0-pro-fast',
  'seedance-1.0-lite',
];

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

/**
 * 将逻辑模型 ID + 分辨率拼接为 API 实际模型名
 * seedance-1.5-pro + 720p → doubao-seedance-1-5-pro_720p
 */
const resolveActualModel = (logicalId: string, resolution: string): string => {
  // 将 "." 替换为 "-"：seedance-1.5-pro → seedance-1-5-pro
  const normalized = logicalId.replace(/\./g, '-');
  return `doubao-${normalized}_${resolution}`;
};

/**
 * 从 size 参数提取分辨率（480p/720p/1080p）
 */
const extractResolution = (size?: string): string => {
  if (size && /^\d+p$/.test(size)) {
    return size;
  }
  return '720p';
};

const resolveBaseUrl = (context: AdapterContext): string => {
  if (!context.baseUrl) {
    throw new Error('Missing baseUrl for Seedance adapter');
  }
  return context.baseUrl.replace(/\/$/, '');
};

const extractErrorMessage = (
  error?: string | { code: string; message: string }
): string => {
  if (!error) return '视频生成失败';
  if (typeof error === 'string') return error;
  return error.message || '视频生成失败';
};

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
    const data = await response.json().catch(() => null);
    const errMsg =
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message ||
          data?.message ||
          `Seedance submit failed: ${response.status}`;
    throw new Error(errMsg);
  }

  return response.json();
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
    const data = await response.json().catch(() => null);
    const errMsg =
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message ||
          data?.message ||
          `Seedance query failed: ${response.status}`;
    throw new Error(errMsg);
  }

  return response.json();
};

export const seedanceVideoAdapter: VideoModelAdapter = {
  id: 'seedance-video-adapter',
  label: 'Seedance Video',
  kind: 'video',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['seedance.task'],
  matchRequestSchemas: ['seedance.video.form-auto'],
  supportedModels: SEEDANCE_MODELS,
  defaultModel: 'seedance-1.5-pro',

  async generateVideo(context, request: VideoGenerationRequest) {
    const logicalModel = request.model || 'seedance-1.5-pro';
    const resolution = extractResolution(request.size);
    const actualModel = resolveActualModel(logicalModel, resolution);

    // 宽高比从 params.aspect_ratio 或默认 16:9
    const aspectRatio =
      (request.params?.aspect_ratio as string | undefined) ||
      (request.params?.aspectRatio as string | undefined) ||
      '16:9';

    // 首帧/尾帧：referenceImages[0] = 首帧, referenceImages[1] = 尾帧
    const firstFrameImage = request.referenceImages?.[0];
    const lastFrameImage = request.referenceImages?.[1];

    // 参考图（lite 模型）：所有图片作为 input_reference
    const isLite = logicalModel === 'seedance-1.0-lite';
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
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS)
      );
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
      }
    }

    throw new Error('Seedance 视频生成超时');
  },
};

export const registerSeedanceAdapter = (): void => {
  registerModelAdapter(seedanceVideoAdapter);
};
