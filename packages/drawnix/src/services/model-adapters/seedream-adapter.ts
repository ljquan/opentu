import type {
  AdapterContext,
  ImageGenerationRequest,
  ImageModelAdapter,
} from './types';
import { getFileExtension, normalizeImageDataUrl } from '@aitu/utils';
import { registerModelAdapter } from './registry';
import { sendAdapterRequest } from './context';

const DEFAULT_SEEDREAM_MODEL = 'doubao-seedream-5-0-260128';
const SEEDREAM_MODELS = [
  'doubao-seedream-4-0-250828',
  'doubao-seedream-4-5-251128',
  DEFAULT_SEEDREAM_MODEL,
];

/**
 * 宽高比 → Seedream 像素尺寸映射
 * 2K: 总像素约 2048x2048 = 4M，保持比例
 * 4K: 以 4096 为长边，按比例计算短边
 */
const ASPECT_RATIO_TO_SIZE_2K: Record<string, string> = {
  '21:9':  '3024x1296',
  '21x9':  '3024x1296',
  '16:9':  '2560x1440',
  '16x9':  '2560x1440',
  '3:2':   '2496x1664',
  '3x2':   '2496x1664',
  '4:3':   '2304x1728',
  '4x3':   '2304x1728',
  '1:1':   '2048x2048',
  '1x1':   '2048x2048',
  '3:4':   '1728x2304',
  '3x4':   '1728x2304',
  '2:3':   '1664x2496',
  '2x3':   '1664x2496',
  '9:16':  '1440x2560',
  '9x16':  '1440x2560',
};

const ASPECT_RATIO_TO_SIZE_3K: Record<string, string> = {
  '21:9':  '4704x2016',
  '21x9':  '4704x2016',
  '16:9':  '4096x2304',
  '16x9':  '4096x2304',
  '3:2':   '3744x2496',
  '3x2':   '3744x2496',
  '4:3':   '3456x2592',
  '4x3':   '3456x2592',
  '1:1':   '3072x3072',
  '1x1':   '3072x3072',
  '3:4':   '2592x3456',
  '3x4':   '2592x3456',
  '2:3':   '2496x3744',
  '2x3':   '2496x3744',
  '9:16':  '2304x4096',
  '9x16':  '2304x4096',
};

const ASPECT_RATIO_TO_SIZE_4K: Record<string, string> = {
  '21:9':  '6197x2656',
  '21x9':  '6197x2656',
  '16:9':  '5404x3040',
  '16x9':  '5404x3040',
  '3:2':   '4992x3328',
  '3x2':   '4992x3328',
  '4:3':   '4693x3520',
  '4x3':   '4693x3520',
  '1:1':   '4096x4096',
  '1x1':   '4096x4096',
  '3:4':   '3520x4693',
  '3x4':   '3520x4693',
  '2:3':   '3328x4992',
  '2x3':   '3328x4992',
  '9:16':  '3040x5404',
  '9x16':  '3040x5404',
};

/**
 * 将 size 参数（宽高比 token）+ quality(2k/3k/4k) 解析为 Seedream 需要的像素尺寸
 */
const resolveSeedreamSize = (
  size?: string,
  quality?: string
): string | undefined => {
  if (!size || size === 'auto') return undefined;

  const sizeMap =
    quality === '4k'
      ? ASPECT_RATIO_TO_SIZE_4K
      : quality === '3k'
        ? ASPECT_RATIO_TO_SIZE_3K
        : ASPECT_RATIO_TO_SIZE_2K;

  // 先查比例映射表
  const mapped = sizeMap[size];
  if (mapped) return mapped;

  // 如果已经是像素值格式（如 2048x2048），直接使用
  if (/^\d+x\d+$/.test(size)) return size;

  // 默认 1:1
  return quality === '4k'
    ? '4096x4096'
    : quality === '3k'
      ? '3072x3072'
      : '2048x2048';
};

const resolveBaseUrl = (context: AdapterContext): string => {
  if (!context.baseUrl) {
    throw new Error('Missing baseUrl for Seedream adapter');
  }
  return context.baseUrl.replace(/\/$/, '');
};

export const seedreamImageAdapter: ImageModelAdapter = {
  id: 'seedream-image-adapter',
  label: 'Seedream Image',
  kind: 'image',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['openai.images.generations'],
  matchRequestSchemas: ['openai.image.seedream-json'],
  matchTags: ['seedream'],
  supportedModels: SEEDREAM_MODELS,
  defaultModel: DEFAULT_SEEDREAM_MODEL,

  async generateImage(context, request: ImageGenerationRequest) {
    const model = request.model || DEFAULT_SEEDREAM_MODEL;
    const quality = (request.params?.seedream_quality as string) || '2k';
    const size = resolveSeedreamSize(request.size, quality);

    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      response_format: 'url',
    };

    if (size) {
      body.size = size;
    }

    // 参考图：单图传字符串，多图传数组
    if (request.referenceImages && request.referenceImages.length > 0) {
      body.image =
        request.referenceImages.length === 1
          ? request.referenceImages[0]
          : request.referenceImages;
    }

    const baseUrl = resolveBaseUrl(context);
    const response = await sendAdapterRequest(
      context,
      {
        path: '/images/generations',
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
          : data?.error?.message ||
            data?.message ||
            `Seedream request failed: ${response.status}`;
      throw new Error(errMsg);
    }

    const result = await response.json();

    // 提取图片 URL（支持多图）
    if (result?.data && Array.isArray(result.data) && result.data.length > 0) {
      const urls = result.data
        .map((item: any) => {
          const rawValue = item.url || item.b64_json;
          if (typeof rawValue === 'string') {
            return normalizeImageDataUrl(rawValue);
          }
          return undefined;
        })
        .filter(Boolean) as string[];

      const first = urls[0];
      if (first) {
        const format = getFileExtension(first);
        return {
          url: first,
          urls,
          format: format === 'bin' ? 'png' : format,
          raw: result,
        };
      }
    }

    throw new Error('Seedream API 未返回有效的图片数据');
  },
};

export const registerSeedreamAdapter = (): void => {
  registerModelAdapter(seedreamImageAdapter);
};
