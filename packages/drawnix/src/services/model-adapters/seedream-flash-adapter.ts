import {
  SEEDREAM_FLASH_MODEL_ID,
  SEEDREAM_FLASH_PATH,
  SEEDREAM_FLASH_REQUEST_SCHEMA,
  SEEDREAM_FLASH_SIZES,
} from '../../constants/seedream-flash';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';
import { readProviderResponseJson } from '../provider-routing';
import { sendAdapterRequest } from './context';
import { resolveGeneratedImageDimensions } from './gpt-image-adapter';
import { registerModelAdapter } from './registry';
import type {
  AdapterContext,
  ImageGenerationRequest,
  ImageModelAdapter,
} from './types';

const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function enumValue(
  value: unknown,
  options: readonly string[],
  label: string
): string {
  if (typeof value !== 'string' || !options.includes(value)) {
    throw new Error(`Seedream Flash ${label}必须为 ${options.join('、')}`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  // Existing parameter controls store their values as strings.
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Seedream Flash ${label}必须为布尔值`);
}

function parameter(
  params: Record<string, unknown>,
  key: string,
  fallback: unknown
): unknown {
  return params[key] === undefined ? fallback : params[key];
}

function resolveSize(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('Seedream Flash 尺寸必须为字符串');
  const tier = value.toUpperCase();
  if ((SEEDREAM_FLASH_SIZES as readonly string[]).includes(tier)) return tier;
  const match = /^(\d+)x(\d+)$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  const pixels = width * height;
  if (
    !match ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels < 921_600 ||
    pixels > 4_624_220 ||
    width > height * 16 ||
    height > width * 16
  ) {
    throw new Error(
      'Seedream Flash 尺寸需为 1K、1.5K、2K，或 921600～4624220 像素、宽高比 1:16～16:1 的宽x高'
    );
  }
  return value;
}

function isRemoteImage(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isLocalImage(value: string): boolean {
  return (
    isVirtualMediaUrl(value) || /^blob:/.test(value) || /^\/(?!\/)/.test(value)
  );
}

function decodeImageData(
  value: string,
  maxBytes = MAX_REFERENCE_BYTES
): Uint8Array {
  const match =
    /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[1] || match[1].length % 4 !== 0) {
    throw new Error(
      'Seedream Flash 参考图必须为有效的图片 Base64 Data URL 或 HTTP(S) URL'
    );
  }
  if (match[1].length > Math.ceil(maxBytes / 3) * 4) {
    throw new Error(
      `Seedream Flash 图片数据不能超过 ${maxBytes / 1024 / 1024} MiB`
    );
  }
  const binary = atob(match[1]);
  if (binary.length > maxBytes)
    throw new Error(
      `Seedream Flash 图片数据不能超过 ${maxBytes / 1024 / 1024} MiB`
    );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Inspect PNG chunks, including palette transparency, rather than its filename. */
export function hasSeedreamFlashPngAlpha(bytes: Uint8Array): boolean {
  if (
    bytes.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let alpha = false;
  let hasImageData = false;
  let colorType = -1;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset === 8 && type !== 'IHDR') return false;
    if (type === 'IHDR') {
      if (
        offset !== 8 ||
        length !== 13 ||
        !view.getUint32(offset + 8) ||
        !view.getUint32(offset + 12)
      )
        return false;
      colorType = bytes[offset + 17];
      if (![0, 2, 3, 4, 6].includes(colorType)) return false;
      alpha = colorType === 4 || colorType === 6;
    }
    if (type === 'tRNS') {
      if (
        hasImageData ||
        !(
          (colorType === 0 && length === 2) ||
          (colorType === 2 && length === 6) ||
          (colorType === 3 && length > 0 && length <= 256)
        )
      )
        return false;
      alpha = true;
    }
    if (type === 'IDAT' && length > 0) hasImageData = true;
    if (type === 'IEND')
      return (
        length === 0 && offset + 12 === bytes.length && hasImageData && alpha
      );
    offset += length + 12;
  }
  return false;
}

export function buildSeedreamFlashRequestBody(
  request: ImageGenerationRequest
): Record<string, unknown> {
  if (request.model && request.model !== SEEDREAM_FLASH_MODEL_ID)
    throw new Error('Seedream Flash 模型 ID 不匹配');
  if (typeof request.prompt !== 'string' || !request.prompt.trim())
    throw new Error('Seedream Flash 提示词不能为空');
  if (request.maskImage)
    throw new Error('Seedream Flash 当前接口不支持蒙版编辑');
  const params = request.params || {};
  if (params.n !== undefined && params.n !== 1) {
    throw new Error(
      'Seedream Flash 每次请求只生成一张图片，请通过批量任务分别生成'
    );
  }
  if (
    params.layer_decomposition !== undefined &&
    booleanValue(params.layer_decomposition, '图层拆分')
  ) {
    throw new Error(
      'Seedream Flash 原生拆图定位尚未开放，请使用现有 AI 分层功能'
    );
  }
  if (params.stream !== undefined && booleanValue(params.stream, 'stream'))
    throw new Error('Seedream Flash 不支持流式输出');
  const backgroundValue = parameter(
    params,
    'background',
    request.background === undefined || request.background === 'auto'
      ? 'opaque'
      : request.background
  );
  const background = enumValue(
    backgroundValue,
    ['opaque', 'transparent'],
    '背景'
  );
  const outputFormat = enumValue(
    parameter(
      params,
      'output_format',
      request.outputFormat === undefined ? 'png' : request.outputFormat
    ),
    ['png', 'jpeg'],
    '输出格式'
  );
  const images = request.referenceImages;
  if (images !== undefined && (!Array.isArray(images) || images.length > 10))
    throw new Error('Seedream Flash 最多支持 10 张参考图');
  for (const image of images || []) {
    if (typeof image !== 'string' || !image.trim())
      throw new Error('Seedream Flash 参考图不能为空');
    if (!isRemoteImage(image) && !isLocalImage(image)) decodeImageData(image);
  }
  if (background === 'transparent') {
    if (images?.length !== 1 || outputFormat !== 'png')
      throw new Error(
        'Seedream Flash 透明背景需要恰好一张带透明通道的 PNG 参考图，并使用 PNG 输出'
      );
    if (
      images[0].startsWith('data:') &&
      (!/^data:image\/png;base64,/i.test(images[0]) ||
        !hasSeedreamFlashPngAlpha(decodeImageData(images[0])))
    ) {
      throw new Error(
        'Seedream Flash 透明背景需要有效的带透明通道 PNG，请重新导入原始透明 PNG'
      );
    }
  }
  const body: Record<string, unknown> = {
    model: SEEDREAM_FLASH_MODEL_ID,
    prompt: request.prompt,
    size: resolveSize(
      parameter(
        params,
        'size',
        request.size === undefined ? '1K' : request.size
      )
    ),
    response_format: enumValue(
      parameter(params, 'response_format', 'url'),
      ['url', 'b64_json'],
      '响应格式'
    ),
    output_format: outputFormat,
    background,
    watermark: booleanValue(parameter(params, 'watermark', false), '水印'),
  };
  if (images?.length) body.image = images.length === 1 ? images[0] : images;
  if (params.optimize_prompt_options !== undefined) {
    const options = params.optimize_prompt_options;
    if (!record(options) || Object.keys(options).some((key) => key !== 'mode'))
      throw new Error('Seedream Flash 提示词优化配置无效');
    if (options.mode !== undefined)
      enumValue(options.mode, ['standard'], '提示词优化模式');
    body.optimize_prompt_options = options;
  } else if (
    params.optimize_prompt_mode !== undefined &&
    params.optimize_prompt_mode !== 'default'
  ) {
    body.optimize_prompt_options = {
      mode: enumValue(
        params.optimize_prompt_mode,
        ['standard'],
        '提示词优化模式'
      ),
    };
  }
  return body;
}

async function prepareReference(
  source: string,
  transparent: boolean,
  context: AdapterContext
): Promise<string> {
  if (source.startsWith('data:')) return source;
  if (isRemoteImage(source) && !transparent) return source;
  context.signal?.throwIfAborted();
  let blob: Blob | null = null;
  if (isVirtualMediaUrl(source)) {
    const { unifiedCacheService } = await import('../unified-cache-service');
    blob = await unifiedCacheService.getCachedBlob(source);
    if (!blob)
      throw new Error('Seedream Flash 参考图缓存不可用，请重新导入原始图片');
  } else if (
    isRemoteImage(source) ||
    /^blob:/.test(source) ||
    /^\/(?!\/)/.test(source)
  ) {
    try {
      const response = await (context.fetcher || fetch)(source, {
        signal: context.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      blob = await response.blob();
    } catch (error) {
      if (context.signal?.aborted) throw error;
      throw new Error(
        '无法读取 Seedream Flash 参考图，请下载并重新导入原始 PNG 图片'
      );
    }
  }
  if (!blob?.size) throw new Error('Seedream Flash 参考图无效');
  if (blob.size > MAX_REFERENCE_BYTES)
    throw new Error('Seedream Flash 单张参考图不能超过 30 MiB');
  context.signal?.throwIfAborted();
  const { blobToDataUrl } = await import('@aitu/utils');
  return blobToDataUrl(
    blob.type.startsWith('image/')
      ? blob
      : new Blob([blob], { type: 'image/png' })
  );
}

async function validateTransparentReference(
  source: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(
        new Blob([decodeImageData(source)], { type: 'image/png' })
      );
      try {
        if (!bitmap.width || !bitmap.height)
          throw new Error('Invalid dimensions');
      } finally {
        bitmap.close();
      }
    } else {
      const image = new Image();
      image.src = source;
      await image.decode();
    }
  } catch {
    signal?.throwIfAborted();
    throw new Error(
      'Seedream Flash 透明参考图无法解码，请重新导入有效的透明 PNG'
    );
  }
  signal?.throwIfAborted();
}

export const seedreamFlashImageAdapter: ImageModelAdapter = {
  id: 'seedream-flash-image-adapter',
  label: 'Seedream 5.0 Flash',
  kind: 'image',
  matchRequestSchemas: [SEEDREAM_FLASH_REQUEST_SCHEMA],
  matchModels: [SEEDREAM_FLASH_MODEL_ID],
  supportedModels: [SEEDREAM_FLASH_MODEL_ID],
  defaultModel: SEEDREAM_FLASH_MODEL_ID,
  async generateImage(context, request) {
    // Validate combinations before downloading references or sending a paid request.
    const rawReferences = request.referenceImages;
    const body = buildSeedreamFlashRequestBody(request);
    if (rawReferences?.length) {
      const prepared: string[] = [];
      for (const source of rawReferences) {
        prepared.push(
          await prepareReference(
            source,
            body.background === 'transparent',
            context
          )
        );
      }
      Object.assign(
        body,
        buildSeedreamFlashRequestBody({ ...request, referenceImages: prepared })
      );
      if (body.background === 'transparent') {
        await validateTransparentReference(prepared[0], context.signal);
      }
    }
    let response: Response;
    try {
      response = await sendAdapterRequest(context, {
        path: SEEDREAM_FLASH_PATH,
        baseUrlStrategy: 'trim-v1',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        allowImageSubmissionOutcomeRecovery: false,
      });
    } catch (error) {
      if (context.signal?.aborted) throw error;
      throw new Error(
        'Seedream Flash 未取得确定的生成结果，请先核对控制台使用记录，避免重复提交和扣费'
      );
    }
    const data = await readProviderResponseJson<unknown>(response).catch(() => {
      throw new Error(
        `Seedream Flash 响应无法读取（HTTP ${response.status}），请先核对控制台使用记录，避免重复提交`
      );
    });
    if (!record(data))
      throw new Error('Seedream Flash 响应格式无效，请先核对控制台使用记录');
    if (!response.ok || data.error) {
      const message =
        typeof data.error === 'string'
          ? data.error
          : record(data.error)
          ? data.error.message
          : data.message;
      throw Object.assign(
        new Error(
          typeof message === 'string'
            ? message
            : `Seedream Flash 请求失败（HTTP ${response.status}）`
        ),
        { httpStatus: response.status }
      );
    }
    if (
      !Array.isArray(data.data) ||
      data.data.length !== 1 ||
      !record(data.data[0]) ||
      data.data[0].z_index !== undefined
    ) {
      throw new Error(
        'Seedream Flash 普通生成应返回一张有效图片，不能将图层响应作为普通图片处理'
      );
    }
    const item = data.data[0];
    const format = enumValue(
      item.output_format === undefined
        ? body.output_format
        : item.output_format,
      ['png', 'jpeg'],
      '返回格式'
    );
    if (body.background === 'transparent' && format !== 'png') {
      throw new Error('Seedream Flash 透明背景请求未返回 PNG，请核对服务输出');
    }
    let url: string;
    if (body.response_format === 'b64_json') {
      if (typeof item.b64_json !== 'string')
        throw new Error('Seedream Flash 响应缺少 b64_json');
      url = item.b64_json.startsWith('data:')
        ? item.b64_json
        : `data:image/${format};base64,${item.b64_json}`;
      if (!url.startsWith(`data:image/${format};base64,`))
        throw new Error('Seedream Flash 返回图片 MIME 与格式不符');
      const bytes = decodeImageData(url, 64 * 1024 * 1024);
      if (
        format === 'png'
          ? ![137, 80, 78, 71, 13, 10, 26, 10].every(
              (value, i) => bytes[i] === value
            )
          : !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      ) {
        throw new Error('Seedream Flash 返回图片内容与格式不符');
      }
    } else {
      if (typeof item.url !== 'string' || !isRemoteImage(item.url))
        throw new Error('Seedream Flash 响应缺少有效图片 URL');
      url = item.url;
    }
    const size =
      typeof item.size === 'string' ? /^(\d+)x(\d+)$/.exec(item.size) : null;
    const width = Number(size?.[1]);
    const height = Number(size?.[2]);
    return resolveGeneratedImageDimensions(
      {
        url,
        urls: [url],
        format,
        raw: data,
        ...(Number.isSafeInteger(width) &&
        width > 0 &&
        Number.isSafeInteger(height) &&
        height > 0
          ? { width, height }
          : {}),
      },
      context.signal
    );
  },
};

export function registerSeedreamFlashAdapter(): void {
  registerModelAdapter(seedreamFlashImageAdapter);
}
