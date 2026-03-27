import type {
  AdapterContext,
  ImageGenerationRequest,
  ImageModelAdapter,
} from './types';
import { registerModelAdapter } from './registry';
import { ModelVendor } from '../../constants/model-config';
import { sendAdapterRequest } from './context';

type FluxSubmitResponse = {
  id: string;
  polling_url?: string;
};

type FluxResultResponse = {
  id: string;
  status: 'Ready' | 'Pending' | 'Error' | string;
  result?: {
    sample?: string;
    seed?: number;
    prompt?: string;
    duration?: number;
  };
};

const FLUX_MODELS = [
  'bfl-flux-2-pro',
  'bfl-flux-2-max',
  'bfl-flux-2-flex',
  'flux-kontext-pro',
  'flux-kontext-max',
];

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_MAX_ATTEMPTS = 200; // ~10 min

/**
 * 宽高比 → Flux 像素尺寸映射（均为 16 的倍数）
 */
const ASPECT_RATIO_TO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1':  { width: 1024, height: 1024 },
  '1x1':  { width: 1024, height: 1024 },
  '2:3':  { width: 832,  height: 1248 },
  '2x3':  { width: 832,  height: 1248 },
  '3:2':  { width: 1248, height: 832 },
  '3x2':  { width: 1248, height: 832 },
  '3:4':  { width: 768,  height: 1024 },
  '3x4':  { width: 768,  height: 1024 },
  '4:3':  { width: 1024, height: 768 },
  '4x3':  { width: 1024, height: 768 },
  '4:5':  { width: 832,  height: 1040 },
  '4x5':  { width: 832,  height: 1040 },
  '5:4':  { width: 1040, height: 832 },
  '5x4':  { width: 1040, height: 832 },
  '9:16': { width: 720,  height: 1280 },
  '9x16': { width: 720,  height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '16x9': { width: 1280, height: 720 },
  '21:9': { width: 1344, height: 576 },
  '21x9': { width: 1344, height: 576 },
};

/**
 * 将 size 参数解析为 Flux 需要的 width/height
 * size 可能是比例 token（如 "16x9"）或实际像素（如 "1280x720"）
 */
const resolveFluxDimensions = (
  size?: string
): { width: number; height: number } | undefined => {
  if (!size) return undefined;

  // 先查比例映射表
  const mapped = ASPECT_RATIO_TO_DIMENSIONS[size];
  if (mapped) return mapped;

  // 尝试解析为实际像素值
  if (!size.includes('x')) return undefined;
  const [wStr, hStr] = size.split('x');
  const w = Number(wStr);
  const h = Number(hStr);
  if (!w || !h) return undefined;

  // 确保是 16 的倍数
  return {
    width: Math.round(w / 16) * 16,
    height: Math.round(h / 16) * 16,
  };
};

const resolveBaseUrl = (context: AdapterContext): string => {
  if (!context.baseUrl) {
    throw new Error('Missing baseUrl for Flux adapter');
  }
  const normalized = context.baseUrl.replace(/\/$/, '');
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized;
};

/**
 * 提交 Flux 图片生成任务
 */
const submitFluxImage = async (
  context: AdapterContext,
  model: string,
  body: Record<string, unknown>
): Promise<FluxSubmitResponse> => {
  const baseUrl = resolveBaseUrl(context);
  const response = await sendAdapterRequest(
    context,
    {
      path: `/flux/v1/${model}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    baseUrl
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const errMsg =
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message || data?.message || `Flux submit failed: ${response.status}`;
    throw new Error(errMsg);
  }

  return response.json();
};

/**
 * 查询 Flux 任务结果
 */
const queryFluxResult = async (
  context: AdapterContext,
  taskId: string
): Promise<FluxResultResponse> => {
  const baseUrl = resolveBaseUrl(context);
  const response = await sendAdapterRequest(
    context,
    {
      path: '/flux/v1/get_result',
      method: 'GET',
      query: {
        id: taskId,
      },
    },
    baseUrl
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const errMsg =
      typeof data?.error === 'string'
        ? data.error
        : data?.error?.message || data?.message || `Flux query failed: ${response.status}`;
    throw new Error(errMsg);
  }

  return response.json();
};

export const fluxImageAdapter: ImageModelAdapter = {
  id: 'flux-image-adapter',
  label: 'Flux Image',
  kind: 'image',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['flux.task'],
  matchRequestSchemas: ['flux.image.polling-json'],
  matchVendors: [ModelVendor.FLUX],
  supportedModels: FLUX_MODELS,
  defaultModel: 'bfl-flux-2-flex',

  async generateImage(context, request: ImageGenerationRequest) {
    const model = request.model || 'bfl-flux-2-flex';
    const dimensions = resolveFluxDimensions(request.size);

    // 构建请求体
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      output_format: 'png',
    };

    if (dimensions) {
      body.width = dimensions.width;
      body.height = dimensions.height;
    }

    // 参考图：input_image, input_image_2 ... input_image_8
    if (request.referenceImages && request.referenceImages.length > 0) {
      request.referenceImages.forEach((img, index) => {
        if (index === 0) {
          body.input_image = img;
        } else if (index <= 7) {
          body[`input_image_${index + 1}`] = img;
        }
      });
    }

    // 通知提交中
    const onProgress = request.params?.onProgress as
      | ((progress: number, status?: string) => void)
      | undefined;
    const onSubmitted = request.params?.onSubmitted as
      | ((remoteId: string) => void)
      | undefined;

    onProgress?.(5, 'submitting');

    // 提交任务
    const submitResult = await submitFluxImage(context, model, body);
    const remoteId = submitResult.id;

    if (!remoteId) {
      throw new Error('Flux API 未返回任务 ID');
    }

    onSubmitted?.(remoteId);
    onProgress?.(10, 'processing');

    // 轮询结果
    let attempts = 0;
    while (attempts < DEFAULT_POLL_MAX_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS)
      );
      attempts += 1;

      const result = await queryFluxResult(context, remoteId);

      // 更新进度：10-90 范围
      const progressValue = Math.min(10 + attempts * 2, 90);
      onProgress?.(progressValue, result.status);

      if (result.status === 'Ready') {
        const imageUrl = result.result?.sample;
        if (!imageUrl) {
          throw new Error('Flux 结果缺少图片 URL');
        }
        return { url: imageUrl, format: 'png', raw: result };
      }

      if (result.status === 'Error') {
        throw new Error(
          result.result?.prompt || 'Flux 图片生成失败'
        );
      }
    }

    throw new Error('Flux 图片生成超时');
  },
};

export const registerFluxAdapter = (): void => {
  registerModelAdapter(fluxImageAdapter);
};
