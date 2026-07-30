import {
  base64ToBlob,
  getFileExtension,
  normalizeImageDataUrl,
} from '@aitu/utils';
import {
  resolveOfficialGPTImageQuality,
  resolveOfficialGPTImageEditSize,
  resolveOfficialGPTImageSize,
} from './image-size-quality-resolver';
import { sendAdapterRequest } from './context';
import { registerModelAdapter } from './registry';
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageModelAdapter,
} from './types';

const GPT_IMAGE_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const GPT_IMAGE_BACKGROUND_VALUES = new Set(['transparent', 'opaque', 'auto']);
const GPT_IMAGE_MODERATION_VALUES = new Set(['low', 'auto']);
const GPT_IMAGE_INPUT_FIDELITY_VALUES = new Set(['high', 'low']);
const GPT_IMAGE_RESPONSE_FORMAT_VALUES = new Set(['url', 'b64_json']);

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
  return fieldValue && fieldValue.trim()
    ? fieldValue.trim()
    : getStringParam(params, key);
}

function getNumberFieldOrParam(
  fieldValue: number | undefined,
  params: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue)
    ? fieldValue
    : getNumberParam(params, key);
}

function setAllowedStringParam(
  body: Record<string, unknown>,
  params: Record<string, unknown> | undefined,
  key: string,
  allowed: Set<string>
): void {
  const value = getStringParam(params, key);
  if (value && allowed.has(value)) {
    body[key] = value;
  }
}

function setAllowedStringValue(
  body: Record<string, unknown>,
  key: string,
  value: string | undefined,
  allowed: Set<string>
): void {
  if (value && allowed.has(value)) {
    body[key] = value;
  }
}

function getGPTImageResponseFormat(
  params: Record<string, unknown> | undefined
): 'url' | 'b64_json' | undefined {
  const value = getStringParam(params, 'response_format');
  return value && GPT_IMAGE_RESPONSE_FORMAT_VALUES.has(value)
    ? (value as 'url' | 'b64_json')
    : undefined;
}

function applyCommonGPTImageOptions(
  body: Record<string, unknown>,
  request: ImageGenerationRequest,
  mode: 'generation' | 'edit' = 'generation'
): void {
  const params = request.params;
  const requestedSize = getStringParam(params, 'size') || request.size;
  const size =
    mode === 'edit'
      ? resolveOfficialGPTImageEditSize(request.model, requestedSize, params)
      : resolveOfficialGPTImageSize(request.model, requestedSize, params);
  const quality = resolveOfficialGPTImageQuality(params);
  const n = getNumberParam(params, 'n') ?? getNumberParam(params, 'count');
  const outputCompression = getNumberFieldOrParam(
    request.outputCompression,
    params,
    'output_compression'
  );
  const user = getStringParam(params, 'user');
  const outputFormat = getStringFieldOrParam(
    request.outputFormat,
    params,
    'output_format'
  );
  const background = getStringFieldOrParam(
    request.background,
    params,
    'background'
  );

  if (size) {
    body.size = size;
  }
  if (n !== undefined && n >= 1 && n <= 10) {
    body.n = n;
  }
  if (
    outputCompression !== undefined &&
    outputCompression >= 0 &&
    outputCompression <= 100
  ) {
    body.output_compression = outputCompression;
  }
  if (user) {
    body.user = user;
  }
  if (quality) {
    body.quality = quality;
  }

  setAllowedStringValue(
    body,
    'output_format',
    outputFormat,
    GPT_IMAGE_OUTPUT_FORMATS
  );
  setAllowedStringValue(
    body,
    'background',
    background,
    GPT_IMAGE_BACKGROUND_VALUES
  );
  setAllowedStringParam(
    body,
    params,
    'moderation',
    GPT_IMAGE_MODERATION_VALUES
  );
}

export function buildGPTImageGenerationBody(
  request: ImageGenerationRequest
): Record<string, unknown> {
  if (!request.model) {
    throw new Error('GPT Image 请求缺少模型 ID');
  }

  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
  };
  const responseFormat = getGPTImageResponseFormat(request.params);
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  applyCommonGPTImageOptions(body, request, 'generation');

  return body;
}

function appendFormValue(
  formData: FormData,
  key: string,
  value: unknown
): void {
  if (value === undefined || value === null) {
    return;
  }
  formData.append(key, String(value));
}

function getBlobExtension(blob: Blob, source: string): string {
  const sourceExtension = getFileExtension(source, blob.type);
  if (sourceExtension && sourceExtension !== 'bin') {
    return sourceExtension;
  }

  const mimeExtension = getFileExtension('', blob.type || 'image/png');
  return mimeExtension === 'bin' ? 'png' : mimeExtension;
}

async function imageInputToBlob(
  value: string,
  filenamePrefix: string,
  fetcher: typeof fetch = fetch
): Promise<{ blob: Blob; filename: string }> {
  const normalized = normalizeImageDataUrl(value, 'image/png');

  if (normalized.startsWith('data:')) {
    const blob = base64ToBlob(normalized);
    return {
      blob,
      filename: `${filenamePrefix}.${getBlobExtension(blob, normalized)}`,
    };
  }

  const response = await fetcher(normalized);
  if (!response.ok) {
    throw new Error(
      `GPT Image 编辑图片读取失败: ${response.status} ${response.statusText}`
    );
  }

  const blob = await response.blob();
  return {
    blob,
    filename: `${filenamePrefix}.${getBlobExtension(blob, normalized)}`,
  };
}

export async function buildGPTImageEditFormData(
  request: ImageGenerationRequest,
  fetcher?: typeof fetch
): Promise<FormData> {
  if (!request.model) {
    throw new Error('GPT Image 编辑请求缺少模型 ID');
  }

  const referenceImages = request.referenceImages || [];
  if (referenceImages.length === 0) {
    throw new Error('GPT Image 编辑请求缺少参考图片');
  }

  const params = request.params;
  const inputFidelity = getStringFieldOrParam(
    request.inputFidelity,
    params,
    'input_fidelity'
  );
  const maskImage =
    getStringFieldOrParam(request.maskImage, params, 'maskImage') ||
    getStringParam(params, 'mask_image');
  const fields: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
  };
  const responseFormat = getGPTImageResponseFormat(params);
  if (responseFormat) {
    fields.response_format = responseFormat;
  }

  setAllowedStringValue(
    fields,
    'input_fidelity',
    inputFidelity,
    GPT_IMAGE_INPUT_FIDELITY_VALUES
  );
  applyCommonGPTImageOptions(fields, request, 'edit');

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    appendFormValue(formData, key, value);
  }

  for (let index = 0; index < referenceImages.length; index += 1) {
    const { blob, filename } = await imageInputToBlob(
      referenceImages[index]!,
      `image-${index + 1}`,
      fetcher
    );
    formData.append('image[]', blob, filename);
  }

  if (maskImage) {
    const { blob, filename } = await imageInputToBlob(
      maskImage,
      'mask',
      fetcher
    );
    formData.append('mask', blob, filename);
  }

  return formData;
}

function isGPTImageEditRequest(
  request: ImageGenerationRequest,
  requestSchema?: string
): boolean {
  const hasReferenceImages =
    (request.referenceImages && request.referenceImages.length > 0) ||
    request.maskImage;
  if (!hasReferenceImages) {
    return false;
  }
  if (requestSchema === 'openai.image.gpt-edit-form') {
    return true;
  }
  return (
    request.generationMode === 'image_edit' ||
    request.generationMode === 'image_to_image'
  );
}

function resolveGPTImagePath(
  context: { binding?: { submitPath?: string; requestSchema?: string } | null },
  isEditRequest: boolean
): string {
  const binding = context.binding;

  if (isEditRequest) {
    return binding?.requestSchema === 'openai.image.gpt-edit-form' &&
      binding.submitPath
      ? binding.submitPath
      : '/images/edits';
  }

  if (binding?.submitPath && binding.submitPath !== '/images/edits') {
    return binding.submitPath;
  }

  return '/images/generations';
}

function normalizeImageValue(
  value: unknown,
  fallbackFormat?: string
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const mimeType = fallbackFormat ? `image/${fallbackFormat}` : 'image/png';
  return normalizeImageDataUrl(value, mimeType);
}

export function parseGPTImageResponse(
  response: unknown,
  fallbackFormat?: string
): ImageGenerationResult {
  const data = response as {
    data?: Array<Record<string, unknown>>;
    output_format?: string;
  };
  const formatHint =
    typeof data?.output_format === 'string'
      ? data.output_format
      : fallbackFormat;

  if (Array.isArray(data?.data)) {
    const urls = data.data
      .map((item) =>
        normalizeImageValue(item.b64_json || item.url, formatHint || 'png')
      )
      .filter(Boolean) as string[];
    const firstUrl = urls[0];

    if (firstUrl) {
      const format = getFileExtension(firstUrl) || formatHint || 'png';
      return {
        url: firstUrl,
        urls,
        format: format === 'bin' ? formatHint || 'png' : format,
        raw: response,
      };
    }
  }

  throw new Error('GPT Image API 未返回有效的图片数据');
}

async function readErrorMessage(response: Response): Promise<string> {
  const data = await response.json().catch(() => null);
  if (typeof data?.error === 'string') {
    return data.error;
  }
  if (typeof data?.error?.message === 'string') {
    return data.error.message;
  }
  if (typeof data?.message === 'string') {
    return data.message;
  }
  return `GPT Image request failed: ${response.status}`;
}

export const gptImageAdapter: ImageModelAdapter = {
  id: 'gpt-image-adapter',
  label: 'GPT Image',
  kind: 'image',
  docsUrl: 'https://platform.openai.com/docs/api-reference/images',
  matchRequestSchemas: [
    'openai.image.gpt-generation-json',
    'openai.image.gpt-edit-form',
  ],
  defaultModel: 'gpt-image-2',
  async generateImage(context, request) {
    console.debug('[gpt-image-adapter] generateImage called', {
      bindingProtocol: context.binding?.protocol,
      bindingRequestSchema: context.binding?.requestSchema,
      bindingSubmitPath: context.binding?.submitPath,
      generationMode: request.generationMode,
      hasReferenceImages: !!(request.referenceImages && request.referenceImages.length > 0),
      referenceImagesCount: request.referenceImages?.length ?? 0,
      hasMaskImage: !!request.maskImage,
    });
    const isEditRequest = isGPTImageEditRequest(
      request,
      context.binding?.requestSchema
    );
    console.debug('[gpt-image-adapter] isEditRequest:', isEditRequest);
    const editFormData = isEditRequest
      ? await buildGPTImageEditFormData(request, context.fetcher)
      : null;
    const generationBody = isEditRequest
      ? null
      : buildGPTImageGenerationBody(request);
    const outputFormat = editFormData
      ? (editFormData.get('output_format') as string | null) || undefined
      : typeof generationBody?.output_format === 'string'
      ? generationBody.output_format
      : undefined;
    const response = await sendAdapterRequest(context, {
      path: resolveGPTImagePath(context, isEditRequest),
      method: 'POST',
      headers: isEditRequest
        ? undefined
        : {
            'Content-Type': 'application/json',
          },
      body: editFormData || JSON.stringify(generationBody),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const result = await response.json();
    return parseGPTImageResponse(result, outputFormat);
  },
};

export const registerGPTImageAdapter = (): void => {
  registerModelAdapter(gptImageAdapter);
};
