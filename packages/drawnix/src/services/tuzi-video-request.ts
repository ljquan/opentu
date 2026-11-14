import {
  getTuziVideoModelConfig,
  KLING_4_RATIO_OPTIONS,
  normalizeKling4VideoParams,
} from '../constants/tuzi-video-models';

export interface TuziVideoRequest {
  model: string;
  prompt: string;
  duration?: string | number;
  size?: string;
  referenceImages?: string[];
  params?: Record<string, unknown>;
}

function integer(
  value: unknown,
  min: number,
  max: number,
  label: string
): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).trim() === '' ||
    !Number.isInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new Error(`${label} 必须是 ${min}–${max} 的整数`);
  }
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${label} 必须是 true 或 false`);
}

async function imageInput(
  url: string,
  model: string,
  resolveImage?: (url: string) => Promise<string>
): Promise<string> {
  if (/^https?:\/\//i.test(url)) return url;
  if (model.toLowerCase() === 'gemini-omni-1.2-flash') {
    throw new Error('Gemini Omni 1.2 的参考图需要公网 HTTP(S) URL');
  }
  const image = url.startsWith('data:') ? url : await resolveImage?.(url);
  const mimeTypes =
    model.toLowerCase() === 'kling-4.0' ? 'png|jpeg|jpg' : 'png|jpeg|jpg|webp';
  if (
    !image ||
    !new RegExp(`^data:image/(${mimeTypes});base64,`, 'i').test(image)
  ) {
    throw new Error(`${model} 不支持该参考图片格式`);
  }
  return image;
}

/** Build generation fields only; editing and other media inputs stay separate. */
export async function buildTuziVideoRequest(
  request: TuziVideoRequest,
  resolveImage?: (url: string) => Promise<string>
): Promise<Record<string, unknown> | null> {
  const config = getTuziVideoModelConfig(request.model);
  if (!config) return null;
  const { model, params = {} } = request;
  const duration = integer(
    request.duration ?? params.duration ?? config.defaultDuration,
    Number(config.durationOptions[0].value),
    Number(config.durationOptions[config.durationOptions.length - 1].value),
    `${model} 视频时长`
  );
  const outputParams = normalizeKling4VideoParams<Record<string, unknown>>(model, {
    ...params,
    size: request.size || params.size || config.defaultSize,
  });
  const size = String(outputParams.size);
  const sizeOption = config.sizeOptions.find((option) => option.value === size);
  if (!sizeOption) {
    throw new Error(`${model} 不支持视频尺寸 ${size}`);
  }
  const isHappyHorse = config.provider === 'happyhorse';
  const isI2V = isHappyHorse && config.id.endsWith('-i2v');
  const isR2V = isHappyHorse && config.id.endsWith('-r2v');
  if (!isI2V && !request.prompt.trim()) throw new Error(`${model} 需要提示词`);
  let references = request.referenceImages || [];
  if (config.provider === 'wan' && (params.first_frame || params.last_frame)) {
    if (references.length) throw new Error('首尾帧输入不能重复指定');
    if (!params.first_frame) throw new Error('尾帧需要同时提供首帧');
    references = params.last_frame
      ? ([params.first_frame, params.last_frame] as string[])
      : ([params.first_frame] as string[]);
  }
  if (!references.length) {
    const input = isI2V
      ? params.image
      : isR2V
      ? params.images
      : params.input_reference;
    references = Array.isArray(input)
      ? (input as string[])
      : typeof input === 'string'
      ? [input]
      : [];
  }
  if (references.length > config.imageUpload.maxCount)
    throw new Error(
      `${model} 最多支持 ${config.imageUpload.maxCount} 张参考图`
    );
  if (config.imageUpload.required && !references.length)
    throw new Error(`${model} 需要参考图片`);
  if (references.some((url) => typeof url !== 'string' || !url.trim()))
    throw new Error('参考图片不能为空，尾帧需要同时提供首帧');
  const images = await Promise.all(
    references.map((url) => imageInput(url, model, resolveImage))
  );

  if (config.id === 'kling-4.0') {
    const ratio = String(outputParams.ratio ?? 'adaptive');
    if (!KLING_4_RATIO_OPTIONS.includes(ratio))
      throw new Error('Kling 4.0 不支持该视频比例');
    return {
      model,
      contents: [
        { type: 'prompt', text: request.prompt },
        ...images.map((url, index) => ({
          type: 'refer_image',
          url,
          id: `image_${index + 1}`,
        })),
      ],
      settings: { duration, resolution: size, aspect_ratio: ratio },
      ...(params.watermark !== undefined
        ? {
            options: {
              watermark_info: {
                enabled: boolean(params.watermark, 'watermark'),
              },
            },
          }
        : {}),
    };
  }

  const body: Record<string, unknown> = { model, prompt: request.prompt };

  if (isHappyHorse) {
    const parameters: Record<string, unknown> = {
      duration,
      resolution: size,
      watermark: boolean(params.watermark ?? false, 'watermark'),
    };
    if (params.seed !== undefined && params.seed !== '')
      parameters.seed = integer(params.seed, 0, 2147483647, 'seed');
    if (!isI2V) {
      const ratio = params.ratio ?? '16:9';
      if (!['16:9', '9:16', '1:1', '4:3', '3:4'].includes(String(ratio)))
        throw new Error('HappyHorse 不支持该视频比例');
      parameters.ratio = ratio;
    }
    body.parameters = parameters;
    if (isI2V) body.image = images[0];
    if (isR2V) body.images = images;
  } else if (config.provider === 'wan') {
    const ratio = params.ratio ?? 'adaptive';
    if (
      !['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'].includes(String(ratio))
    )
      throw new Error('Wan 3.0 不支持该视频比例');
    Object.assign(body, { duration, resolution: size, ratio });
    if (params.watermark !== undefined)
      body.watermark = boolean(params.watermark, 'watermark');
    if (images[0]) body.first_frame = images[0];
    if (images[1]) body.last_frame = images[1];
  } else {
    Object.assign(body, { seconds: String(duration), size });
    if (images.length)
      body.input_reference = images.length === 1 ? images[0] : images;
  }
  return body;
}
