import {
  normalizeImageResolutionTier,
  resolveOfficialGPTImageQuality,
  resolveOfficialGPTImageSize,
} from './image-size-quality-resolver';
import {
  imageInputToBlob,
  parseGPTImageResponse,
  resolveGeneratedImageDimensions,
} from './gpt-image-adapter';
import {
  normalizeTuziGPTImageModelId,
  shouldRetryTuziGPTImageAlias,
  TUZI_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
  TUZI_GPT_IMAGE_MODEL_ID,
} from './image-request-schemas';
import { sendAdapterRequest } from './context';
import {
  readProviderResponseJson,
  readProviderResponseText,
} from '../provider-routing';
import { registerModelAdapter } from './registry';
import type { ImageGenerationRequest, ImageModelAdapter } from './types';
import {
  GPT_IMAGE_2_MODEL_IDS,
  isGPTImage2ModelId,
} from '../../constants/model-config';

type TuziResponseFormat = 'url' | 'b64_json';

const TUZI_IMAGE_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const TUZI_IMAGE_MODERATION_VALUES = new Set(['auto', 'low']);

function getStringParam(
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getNumberParam(
  params: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = params?.[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function getStringFieldOrParam(
  fieldValue: string | undefined,
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  return fieldValue?.trim() || getStringParam(params, key);
}

function getNumberFieldOrParam(
  fieldValue: number | undefined,
  params: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue)
    ? fieldValue
    : typeof params?.[key] === 'string' && String(params[key]).trim()
    ? Number(params[key])
    : getNumberParam(params, key);
}

function getResolvedOfficialSize(
  request: ImageGenerationRequest,
  model: string
): string | undefined {
  const requestedSize = getStringParam(request.params, 'size') || request.size;
  return resolveOfficialGPTImageSize(model, requestedSize, request.params);
}

function getRequestedCount(
  request: ImageGenerationRequest
): number | undefined {
  const count =
    getNumberParam(request.params, 'n') ??
    getNumberParam(request.params, 'count');

  return count !== undefined && count >= 1 && count <= 10 ? count : undefined;
}

function getResponseFormat(
  request: ImageGenerationRequest
): TuziResponseFormat | undefined {
  const responseFormat = getStringParam(request.params, 'response_format');
  return responseFormat === 'url' || responseFormat === 'b64_json'
    ? responseFormat
    : undefined;
}

export function buildTuziGPTImageRequestOptions(
  request: ImageGenerationRequest,
  bindingModelId?: string | null
): {
  size?: string;
  image?: string[];
  response_format?: TuziResponseFormat;
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  count?: number;
  imageSize?: string;
  background?: ImageGenerationRequest['background'];
  output_format?: 'png' | 'jpeg' | 'webp';
  output_compression?: number;
  moderation?: 'auto' | 'low';
  user?: string;
  model: string;
  modelRef: ImageGenerationRequest['modelRef'];
} {
  const model =
    bindingModelId?.trim() ||
    request.modelRef?.modelId?.trim() ||
    request.model?.trim() ||
    TUZI_GPT_IMAGE_MODEL_ID;
  const requestedSize = getStringParam(request.params, 'size') || request.size;
  const useAutomaticRatio =
    GPT_IMAGE_2_MODEL_IDS.includes(model.toLowerCase()) &&
    requestedSize?.trim().toLowerCase() === 'auto';
  const resolution = normalizeImageResolutionTier(request.params?.resolution);
  const background =
    request.background || getStringParam(request.params, 'background');
  const outputFormat = getStringFieldOrParam(
    request.outputFormat,
    request.params,
    'output_format'
  );
  const outputCompression = getNumberFieldOrParam(
    request.outputCompression,
    request.params,
    'output_compression'
  );
  const moderation = getStringParam(request.params, 'moderation');
  const user = getStringParam(request.params, 'user');
  const isImage2 = isGPTImage2ModelId(model);
  if (background === 'transparent' && outputFormat === 'jpeg') {
    throw new Error('透明背景需要 PNG 或 WebP 输出');
  }

  return {
    size: useAutomaticRatio ? 'auto' : getResolvedOfficialSize(request, model),
    imageSize: useAutomaticRatio ? resolution?.toUpperCase() : undefined,
    image:
      request.referenceImages && request.referenceImages.length > 0
        ? request.referenceImages
        : undefined,
    response_format: getResponseFormat(request),
    quality: resolveOfficialGPTImageQuality(request.params, model),
    count: getRequestedCount(request),
    background:
      background === 'auto' ||
      (background === 'transparent' && !isImage2) ||
      background === 'opaque'
        ? background
        : undefined,
    output_format:
      outputFormat && TUZI_IMAGE_OUTPUT_FORMATS.has(outputFormat)
        ? (outputFormat as 'png' | 'jpeg' | 'webp')
        : undefined,
    output_compression:
      outputCompression !== undefined &&
      (outputFormat === 'jpeg' || outputFormat === 'webp') &&
      Number.isInteger(outputCompression) &&
      outputCompression >= 0 &&
      outputCompression <= 100
        ? outputCompression
        : undefined,
    moderation:
      moderation && TUZI_IMAGE_MODERATION_VALUES.has(moderation)
        ? (moderation as 'auto' | 'low')
        : undefined,
    user,
    model,
    modelRef: request.modelRef || null,
  };
}

export function buildTuziGPTImageRequestBody(
  request: ImageGenerationRequest,
  bindingModelId?: string | null
): Record<string, unknown> {
  const options = buildTuziGPTImageRequestOptions(request, bindingModelId);
  const body: Record<string, unknown> = {
    model: options.model,
    prompt: request.prompt,
  };
  if (options.response_format) {
    body.response_format = options.response_format;
  }

  if (options.size) {
    body.size = options.size;
  }
  // Auto controls aspect ratio only; retain the selected tier for Tuzi billing.
  if (options.imageSize) {
    body.generationConfig = { imageConfig: { imageSize: options.imageSize } };
  }
  if (options.image && options.image.length > 0) {
    body.image = options.image;
  }
  if (options.quality) {
    body.quality = options.quality;
  }
  if (typeof options.count === 'number') {
    body.n = options.count;
  }
  if (options.background) {
    body.background = options.background;
  }
  if (options.output_format) {
    body.output_format = options.output_format;
  }
  if (options.output_compression !== undefined) {
    body.output_compression = options.output_compression;
  }
  if (options.moderation) {
    body.moderation = options.moderation;
  }
  if (options.user) {
    body.user = options.user;
  }

  return body;
}

function getTuziMaskImage(request: ImageGenerationRequest): string | undefined {
  return (
    getStringFieldOrParam(request.maskImage, request.params, 'maskImage') ||
    getStringParam(request.params, 'mask_image')
  );
}

export async function buildTuziGPTImageEditFormData(
  request: ImageGenerationRequest,
  bindingModelId?: string | null,
  fetcher?: typeof fetch,
  signal?: AbortSignal
): Promise<FormData> {
  const referenceImages = request.referenceImages || [];
  const maskImage = getTuziMaskImage(request);
  if (referenceImages.length === 0) {
    throw new Error('Tuzi GPT Image 编辑请求缺少参考图片');
  }
  if (!maskImage) {
    throw new Error('Tuzi GPT Image 编辑请求缺少蒙版');
  }

  // Retain Tuzi size/quality semantics while replacing JSON references with files.
  const { image: _image, ...fields } = buildTuziGPTImageRequestBody(
    request,
    bindingModelId
  );
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    );
  }

  const inputFidelity = getStringFieldOrParam(
    request.inputFidelity,
    request.params,
    'input_fidelity'
  );
  if (inputFidelity === 'high' || inputFidelity === 'low') {
    formData.append('input_fidelity', inputFidelity);
  }

  for (const [index, referenceImage] of referenceImages.entries()) {
    const { blob, filename } = await imageInputToBlob(
      referenceImage,
      `image-${index + 1}`,
      fetcher,
      signal
    );
    formData.append('image[]', blob, filename);
  }
  const { blob, filename } = await imageInputToBlob(
    maskImage,
    'mask',
    fetcher,
    signal
  );
  formData.append('mask', blob, filename);
  signal?.throwIfAborted();
  return formData;
}

async function readErrorMessage(response: Response): Promise<string> {
  const rawText = await readProviderResponseText(response).catch(() => '');
  const data = rawText
    ? (() => {
        try {
          return JSON.parse(rawText);
        } catch {
          return null;
        }
      })()
    : null;
  if (typeof data?.error === 'string') {
    return data.error;
  }
  if (typeof data?.error?.message === 'string') {
    return data.error.message;
  }
  if (typeof data?.message === 'string') {
    return data.message;
  }

  const plainText = rawText.trim();
  if (plainText && !/^<!doctype|^<html/i.test(plainText)) {
    return plainText.slice(0, 300);
  }

  let endpoint = '';
  try {
    const url = new URL(response.url);
    endpoint = `${url.hostname}${url.pathname}`;
  } catch {
    endpoint = (response.url || '').split(/[?#]/, 1)[0];
  }

  return `Tuzi GPT Image request failed: ${response.status}${
    endpoint ? ` (${endpoint})` : ''
  }`;
}

export function getTuziGPTImageRequestPath(
  request: ImageGenerationRequest
): string {
  return getTuziMaskImage(request) ? '/images/edits' : '/images/generations';
}

export const tuziGPTImageAdapter: ImageModelAdapter = {
  id: 'tuzi-gpt-image-adapter',
  label: 'Tuzi GPT Image',
  kind: 'image',
  docsUrl: 'https://api.tu-zi.com',
  matchRequestSchemas: [
    'tuzi.image.gpt-generation-json',
    TUZI_GPT_IMAGE_EDIT_REQUEST_SCHEMA,
  ],
  defaultModel: 'gpt-image-2',
  async generateImage(context, request) {
    const requestModel =
      context.binding?.modelId || request.modelRef?.modelId || request.model;
    const path = getTuziGPTImageRequestPath(request);
    const isEditRequest = path === '/images/edits';
    const sendRequest = async (modelId?: string | null) => {
      const body = isEditRequest
        ? await buildTuziGPTImageEditFormData(
            request,
            modelId,
            context.fetcher,
            context.signal
          )
        : JSON.stringify(buildTuziGPTImageRequestBody(request, modelId));
      return sendAdapterRequest(context, {
        path,
        baseUrlStrategy: 'ensure-v1',
        method: 'POST',
        headers: isEditRequest
          ? undefined
          : { 'Content-Type': 'application/json' },
        body,
      });
    };
    let response = await sendRequest(requestModel);

    if (await shouldRetryTuziGPTImageAlias(response, requestModel)) {
      response = await sendRequest(normalizeTuziGPTImageModelId(requestModel));
    }

    if (!response.ok) {
      throw Object.assign(new Error(await readErrorMessage(response)), {
        httpStatus: response.status,
      });
    }

    const result = await readProviderResponseJson(response);
    const responseFormat = getResponseFormat(request);
    const outputFormat = buildTuziGPTImageRequestOptions(
      request,
      requestModel
    ).output_format;

    return resolveGeneratedImageDimensions(
      parseGPTImageResponse(
        result,
        responseFormat === 'b64_json' ? outputFormat || 'png' : undefined
      ),
      context.signal
    );
  },
};

export const registerTuziGPTImageAdapter = (): void => {
  registerModelAdapter(tuziGPTImageAdapter);
};
