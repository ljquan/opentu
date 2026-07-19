import {
  resolveOfficialGPTImageQuality,
  resolveOfficialGPTImageSize,
} from './image-size-quality-resolver';
import { parseGPTImageResponse } from './gpt-image-adapter';
import { TUZI_GPT_IMAGE_EDIT_REQUEST_SCHEMA } from './image-request-schemas';
import { sendAdapterRequest } from './context';
import { registerModelAdapter } from './registry';
import type { ImageGenerationRequest, ImageModelAdapter } from './types';

type TuziResponseFormat = 'url' | 'b64_json';

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
  request: ImageGenerationRequest
): {
  size?: string;
  image?: string[];
  response_format?: TuziResponseFormat;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  count?: number;
  model: string;
  modelRef: ImageGenerationRequest['modelRef'];
} {
  const model = request.model || 'gpt-image-2';

  return {
    size: getResolvedOfficialSize(request, model),
    image:
      request.referenceImages && request.referenceImages.length > 0
        ? request.referenceImages
        : undefined,
    response_format: getResponseFormat(request),
    quality: resolveOfficialGPTImageQuality(request.params),
    count: getRequestedCount(request),
    model,
    modelRef: request.modelRef || null,
  };
}

export function buildTuziGPTImageRequestBody(
  request: ImageGenerationRequest
): Record<string, unknown> {
  const options = buildTuziGPTImageRequestOptions(request);
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
  if (options.image && options.image.length > 0) {
    body.image = options.image;
  }
  if (options.quality) {
    body.quality = options.quality;
  }
  if (typeof options.count === 'number') {
    body.n = options.count;
  }

  return body;
}

async function readErrorMessage(response: Response): Promise<string> {
  const rawText = await response.text().catch(() => '');
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
    endpoint = url.pathname;
  } catch {
    endpoint = (response.url || '').split(/[?#]/, 1)[0];
  }

  return `Tuzi GPT Image request failed: ${response.status}${
    endpoint ? ` (${endpoint})` : ''
  }`;
}

function resolveTuziGPTImagePath(context: {
  binding?: { submitPath?: string } | null;
}): string {
  return context.binding?.submitPath || '/images/generations';
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
    const response = await sendAdapterRequest(context, {
      path: resolveTuziGPTImagePath(context),
      baseUrlStrategy: 'ensure-v1',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildTuziGPTImageRequestBody(request)),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const result = await response.json();
    const responseFormat = getResponseFormat(request);

    return parseGPTImageResponse(
      result,
      responseFormat === 'b64_json' ? 'png' : undefined
    );
  },
};

export const registerTuziGPTImageAdapter = (): void => {
  registerModelAdapter(tuziGPTImageAdapter);
};
