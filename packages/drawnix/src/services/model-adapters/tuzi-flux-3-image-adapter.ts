import {
  FLUX_3_IMAGE_MODEL_ID,
  FLUX_3_IMAGE_ASPECT_RATIOS,
  TUZI_FLUX_3_IMAGE_RESOLUTIONS,
} from '../../constants/model-config';
import { readProviderResponseText } from '../provider-routing';
import { sendAdapterRequest } from './context';
import {
  parseGPTImageResponse,
  resolveGeneratedImageDimensions,
} from './gpt-image-adapter';
import { registerModelAdapter } from './registry';
import type { ImageGenerationRequest, ImageModelAdapter } from './types';

function resolveRatio(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Flux 3 图片比例必须为字符串');
  const ratio = value.trim().replace('x', ':');
  if (FLUX_3_IMAGE_ASPECT_RATIOS.includes(ratio)) return ratio;
  // Accept exact pixel ratios from older saved tasks, without guessing a tier.
  const pixels = /^(\d+):(\d+)$/.exec(ratio);
  if (pixels && Number(pixels[1]) > 0 && Number(pixels[2]) > 0) {
    const matched = FLUX_3_IMAGE_ASPECT_RATIOS.find((candidate) => {
      const [width, height] = candidate.split(':').map(Number);
      return Number(pixels[1]) * height === Number(pixels[2]) * width;
    });
    if (matched) return matched;
  }
  throw new Error(`Flux 3 不支持图片比例: ${value}`);
}

export function buildTuziFlux3ImageRequestBody(
  request: ImageGenerationRequest
): Record<string, unknown> {
  const params = request.params || {};
  const ratio = resolveRatio(
    params.aspect_ratio ?? params.size ?? request.size ?? 'auto'
  );
  const resolution = params.resolution ?? '1k';
  if (
    typeof resolution !== 'string' ||
    !TUZI_FLUX_3_IMAGE_RESOLUTIONS.includes(resolution)
  ) {
    throw new Error(
      'Tuzi Flux 3 分辨率必须为 1k、2k 或 4k；官方 768sq、1.5k 档位尚未验证'
    );
  }
  const format = params.response_format ?? 'url';
  if (format !== 'url' && format !== 'b64_json')
    throw new Error('Flux 3 响应格式必须为 url 或 b64_json');
  const count = params.n ?? params.count ?? 1;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10
  ) {
    throw new Error('Flux 3 图片数量必须为 1 到 10 的整数');
  }
  if (request.maskImage) throw new Error('Flux 3 当前接口不支持蒙版编辑');
  if (request.referenceImages && request.referenceImages.length > 10) {
    throw new Error('Flux 3 最多支持 10 张参考图片');
  }
  const body: Record<string, unknown> = {
    model: FLUX_3_IMAGE_MODEL_ID,
    prompt: request.prompt,
    aspect_ratio: ratio,
    resolution,
    generationConfig: { imageConfig: { imageSize: resolution.toUpperCase() } },
    response_format: format,
    n: count,
  };
  if (request.referenceImages?.length) {
    if (
      request.referenceImages.some(
        (value) => typeof value !== 'string' || !value.trim()
      )
    ) {
      throw new Error('Flux 3 参考图片不能为空');
    }
    body.image = request.referenceImages;
  }
  if (params.grounding !== undefined) {
    if (typeof params.grounding !== 'boolean')
      throw new Error('Flux 3 grounding 必须为布尔值');
    body.grounding = params.grounding;
  }
  if (params.safety_tolerance !== undefined) {
    const safety = params.safety_tolerance;
    if (
      typeof safety !== 'number' ||
      !Number.isInteger(safety) ||
      safety < 0 ||
      safety > 4
    ) {
      throw new Error('Flux 3 safety_tolerance 必须为 0 到 4 的整数');
    }
    body.safety_tolerance = safety;
  }
  return body;
}

export const tuziFlux3ImageAdapter: ImageModelAdapter = {
  id: 'tuzi-flux-3-image-adapter',
  label: 'Tuzi Flux 3 Image',
  kind: 'image',
  docsUrl: 'https://docs.bfl.ml/flux_3/flux3_image_overview',
  matchRequestSchemas: ['tuzi.image.flux-3-generation-json'],
  matchModels: [FLUX_3_IMAGE_MODEL_ID],
  supportedModels: [FLUX_3_IMAGE_MODEL_ID],
  defaultModel: FLUX_3_IMAGE_MODEL_ID,
  async generateImage(context, request) {
    const response = await sendAdapterRequest(context, {
      path: '/images/generations',
      baseUrlStrategy: 'ensure-v1',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTuziFlux3ImageRequestBody(request)),
    });
    const text = await readProviderResponseText(response);
    if (!response.ok && (response.status === 413 ||
        /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large|HTTP\s+413\b/i.test(text))) {
      throw Object.assign(
        new Error('Flux 3 参考图片请求超过上游大小限制，请压缩图片或减少参考图后重试'),
        { httpStatus: response.status, upstreamHttpStatus: 413 }
      );
    }
    if (
      response.headers.get('content-type')?.includes('text/html') ||
      /^\s*(?:<!doctype|<html)/i.test(text)
    ) {
      throw new Error(
        'Tuzi Flux 3 接口返回 HTML 网页，无法解析图片。请检查服务地址并使用 /v1/images/generations'
      );
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Tuzi Flux 3 接口未返回 JSON (HTTP ${response.status})`);
    }
    if (!response.ok) {
      throw Object.assign(
        new Error(
          data?.error?.message ||
            data?.message ||
            (typeof data?.error === 'string'
              ? data.error
              : `Tuzi Flux 3 请求失败: ${response.status}`)
        ),
        { httpStatus: response.status }
      );
    }
    const images = Array.isArray(data?.data)
      ? data.data.filter(
          (item: { url?: unknown; b64_json?: unknown } | null) =>
            (typeof item?.url === 'string' && item.url.trim()) ||
            (typeof item?.b64_json === 'string' && item.b64_json.trim())
        )
      : [];
    if (!images.length) {
      throw new Error('Tuzi Flux 3 API 未返回有效的图片数据');
    }
    const normalized = {
      ...data,
      data: images.map((item: { url?: unknown; b64_json?: unknown }) => ({
        ...item,
        url: typeof item.url === 'string' ? item.url : undefined,
        b64_json: typeof item.b64_json === 'string' && item.b64_json.trim()
          ? item.b64_json.startsWith('data:')
            ? item.b64_json
            : `data:image/${data.output_format === 'jpeg' || data.output_format === 'webp' ? data.output_format : 'png'};base64,${item.b64_json.trim()}`
          : undefined,
      })),
    };
    return resolveGeneratedImageDimensions(
      parseGPTImageResponse(normalized),
      context.signal
    ).then((result) => ({ ...result, raw: data }));
  },
};

export function registerTuziFlux3ImageAdapter(): void {
  registerModelAdapter(tuziFlux3ImageAdapter);
}
