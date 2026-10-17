import { GenerationGatewayError } from './errors';
import { requestProviderJson } from './outbound';
import type {
  CreateGenerationTaskRequest,
  GenerationExecutionResult,
  GenerationRoute,
  GenerationUsage,
} from './types';

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(value: unknown): GenerationUsage | undefined {
  const usage = recordValue(value);
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = numberValue(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return { provider: usage };
  }
  return { inputTokens, outputTokens, totalTokens, provider: usage };
}

function textMessages(input: Record<string, unknown>): unknown[] {
  if (Array.isArray(input.messages)) return input.messages;
  const messages: unknown[] = [];
  if (typeof input.system === 'string') {
    messages.push({ role: 'system', content: input.system });
  }
  messages.push({ role: 'user', content: input.prompt });
  return messages;
}

async function executeText(
  route: GenerationRoute,
  request: CreateGenerationTaskRequest,
  executionId: string
): Promise<GenerationExecutionResult> {
  const payload = await requestProviderJson(route.provider, {
    path: '/v1/chat/completions',
    contentType: 'application/json',
    body: JSON.stringify({
      model: route.modelId,
      messages: textMessages(request.input),
      stream: false,
      ...(request.parameters.temperature === undefined
        ? {}
        : { temperature: request.parameters.temperature }),
      ...(request.parameters.topP === undefined ? {} : { top_p: request.parameters.topP }),
      ...(request.parameters.maxTokens === undefined
        ? {}
        : { max_tokens: request.parameters.maxTokens }),
    }),
    timeoutMs: 45_000,
    maxResponseBytes: 4 * 1024 * 1024,
    idempotencyKey: executionId,
  });
  const response = recordValue(payload);
  const choices = Array.isArray(response?.choices) ? response.choices : [];
  const first = recordValue(choices[0]);
  const message = recordValue(first?.message);
  const text = typeof message?.content === 'string' ? message.content : '';
  if (!text) {
    throw new GenerationGatewayError(
      502,
      'INVALID_UPSTREAM_RESPONSE',
      '文本模型没有返回可用内容'
    );
  }
  return {
    result: {
      type: 'text',
      text,
      finishReason: typeof first?.finish_reason === 'string' ? first.finish_reason : null,
    },
    usage: normalizeUsage(response?.usage),
  };
}

function imageFormData(
  route: GenerationRoute,
  request: CreateGenerationTaskRequest,
  images: string[]
): FormData {
  const form = new FormData();
  form.append('model', route.modelId);
  form.append('prompt', String(request.input.prompt));
  images.forEach((dataUrl, index) => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(dataUrl);
    if (!match) return;
    const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    form.append(
      'image[]',
      new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }),
      `reference-${index + 1}.${extension}`
    );
  });
  for (const [key, value] of Object.entries(request.parameters)) {
    const upstreamKey = key === 'outputFormat' ? 'output_format' : key;
    form.append(upstreamKey, String(value));
  }
  return form;
}

function normalizeImageResult(payload: unknown): GenerationExecutionResult {
  const response = recordValue(payload);
  const data = Array.isArray(response?.data) ? response.data : [];
  const images = data.flatMap((item) => {
    const image = recordValue(item);
    if (!image) return [];
    const url = typeof image.url === 'string' ? image.url : undefined;
    const b64Json = typeof image.b64_json === 'string' ? image.b64_json : undefined;
    if (!url && !b64Json) return [];
    if (b64Json && Buffer.byteLength(b64Json, 'base64') > 8 * 1024 * 1024) {
      throw new GenerationGatewayError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', '图片结果数据过大');
    }
    return [
      {
        ...(url ? { url } : {}),
        ...(b64Json ? { b64Json } : {}),
        ...(typeof image.revised_prompt === 'string'
          ? { revisedPrompt: image.revised_prompt.slice(0, 40_000) }
          : {}),
      },
    ];
  });
  if (!images.length) {
    throw new GenerationGatewayError(
      502,
      'INVALID_UPSTREAM_RESPONSE',
      '图片模型没有返回可用结果'
    );
  }
  return {
    result: { type: 'image', images },
    usage: {
      ...normalizeUsage(response?.usage),
      generatedCount: images.length,
    },
  };
}

async function executeImage(
  route: GenerationRoute,
  request: CreateGenerationTaskRequest,
  executionId: string
): Promise<GenerationExecutionResult> {
  const images = Array.isArray(request.input.images)
    ? (request.input.images as string[])
    : [];
  const payload = images.length
    ? await requestProviderJson(route.provider, {
        path: '/v1/images/edits',
        body: imageFormData(route, request, images),
        timeoutMs: 55_000,
        maxResponseBytes: 12 * 1024 * 1024,
        idempotencyKey: executionId,
      })
    : await requestProviderJson(route.provider, {
        path: '/v1/images/generations',
        contentType: 'application/json',
        body: JSON.stringify({
          model: route.modelId,
          prompt: request.input.prompt,
          ...Object.entries(request.parameters).reduce<Record<string, unknown>>(
            (result, [key, value]) => {
              result[key === 'outputFormat' ? 'output_format' : key] = value;
              return result;
            },
            {}
          ),
        }),
        timeoutMs: 55_000,
        maxResponseBytes: 12 * 1024 * 1024,
        idempotencyKey: executionId,
      });
  return normalizeImageResult(payload);
}

export type GenerationAdapter = (
  route: GenerationRoute,
  request: CreateGenerationTaskRequest,
  executionId: string
)=> Promise<GenerationExecutionResult>;

const adapters: Partial<Record<CreateGenerationTaskRequest['operation'], GenerationAdapter>> = {
  text: executeText,
  image: executeImage,
};

export function resolveGenerationAdapter(
  operation: CreateGenerationTaskRequest['operation']
): GenerationAdapter | null {
  return adapters[operation] || null;
}

export async function executeGeneration(
  route: GenerationRoute,
  request: CreateGenerationTaskRequest,
  executionId: string
): Promise<GenerationExecutionResult> {
  const adapter = resolveGenerationAdapter(request.operation);
  if (adapter) return adapter(route, request, executionId);
  throw new GenerationGatewayError(
    501,
    'OPERATION_NOT_MIGRATED',
    '该生成类型将在 B2 接入服务端任务网关'
  );
}
