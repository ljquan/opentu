import { createHash } from 'node:crypto';
import { GenerationGatewayError } from './errors';
import type {
  CreateGenerationTaskRequest,
  GenerationOperation,
  GenerationReference,
} from './types';

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 120_000;
const FORBIDDEN_ROUTE_KEYS = new Set([
  'apikey',
  'api_key',
  'baseurl',
  'base_url',
  'authorization',
  'authheader',
  'auth_header',
  'authquery',
  'auth_query',
  'extraheaders',
  'extra_headers',
  'headers',
  'providerurl',
  'provider_url',
  'submitpath',
  'submit_path',
  'pollpath',
  'poll_path',
]);

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', `${name} 格式无效`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', `${name} 不能为空`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new GenerationGatewayError(413, 'INPUT_TOO_LARGE', `${name} 内容过长`);
  }
  return result;
}

function finiteNumber(
  value: unknown,
  name: string,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new GenerationGatewayError(400, 'INVALID_PARAMETERS', `${name} 参数无效`);
  }
  return value;
}

function assertNoRouteOverrides(value: unknown, depth = 0): void {
  if (depth > 12) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', '请求嵌套层级过深');
  }
  if (Array.isArray(value)) {
    if (value.length > 200) {
      throw new GenerationGatewayError(400, 'INVALID_REQUEST', '请求数组项目过多');
    }
    value.forEach((item) => assertNoRouteOverrides(item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_ROUTE_KEYS.has(key.toLowerCase())) {
      throw new GenerationGatewayError(
        400,
        'PROVIDER_OVERRIDE_REJECTED',
        '请求不能指定供应商地址、鉴权信息或上游路径'
      );
    }
    assertNoRouteOverrides(nested, depth + 1);
  }
}

function normalizeTextInput(input: Record<string, unknown>): Record<string, unknown> {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const system = typeof input.system === 'string' ? input.system.trim() : '';
  if (prompt) {
    if (prompt.length > MAX_PROMPT_LENGTH || system.length > 40_000) {
      throw new GenerationGatewayError(413, 'INPUT_TOO_LARGE', '文本输入内容过长');
    }
    return { prompt, ...(system ? { system } : {}) };
  }

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', '需要提供 prompt 或 messages');
  }
  if (input.messages.length > 100) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', '消息数量过多');
  }
  let totalLength = 0;
  const messages = input.messages.map((item) => {
    const message = objectValue(item, '消息');
    const role = message.role;
    if (!['system', 'user', 'assistant'].includes(String(role))) {
      throw new GenerationGatewayError(400, 'INVALID_REQUEST', '消息角色无效');
    }
    if (typeof message.content !== 'string') {
      throw new GenerationGatewayError(
        400,
        'UNSUPPORTED_INPUT',
        'B1 文本任务仅支持纯文本消息'
      );
    }
    totalLength += message.content.length;
    return { role, content: message.content };
  });
  if (totalLength > MAX_PROMPT_LENGTH) {
    throw new GenerationGatewayError(413, 'INPUT_TOO_LARGE', '消息内容过长');
  }
  return { messages };
}

function normalizeImageInput(input: Record<string, unknown>): Record<string, unknown> {
  const prompt = stringValue(input.prompt, '图片提示词', 40_000);
  if (input.images === undefined) return { prompt };
  if (!Array.isArray(input.images) || input.images.length > 4) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', '参考图片数量无效');
  }
  let totalBytes = 0;
  const images = input.images.map((value) => {
    if (typeof value !== 'string') {
      throw new GenerationGatewayError(400, 'INVALID_REQUEST', '参考图片格式无效');
    }
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(value);
    if (!match) {
      throw new GenerationGatewayError(
        400,
        'UNSUPPORTED_INPUT',
        'B1 仅支持小型 PNG、JPEG 或 WebP 内联参考图'
      );
    }
    const byteLength = Buffer.byteLength(match[2], 'base64');
    totalBytes += byteLength;
    if (byteLength > 2 * 1024 * 1024 || totalBytes > 3 * 1024 * 1024) {
      throw new GenerationGatewayError(413, 'INPUT_TOO_LARGE', '参考图片过大');
    }
    return value;
  });
  return { prompt, images };
}

function normalizeParameters(
  operation: GenerationOperation,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const allowed =
    operation === 'text'
      ? new Set(['temperature', 'topP', 'maxTokens'])
      : new Set(['size', 'quality', 'n', 'background', 'outputFormat']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new GenerationGatewayError(
        400,
        'INVALID_PARAMETERS',
        `当前任务不支持参数 ${key.slice(0, 60)}`
      );
    }
  }
  if (operation === 'text') {
    return {
      ...(raw.temperature === undefined
        ? {}
        : { temperature: finiteNumber(raw.temperature, 'temperature', 0, 2) }),
      ...(raw.topP === undefined ? {} : { topP: finiteNumber(raw.topP, 'topP', 0, 1) }),
      ...(raw.maxTokens === undefined
        ? {}
        : { maxTokens: Math.floor(finiteNumber(raw.maxTokens, 'maxTokens', 1, 128_000)) }),
    };
  }

  const size = raw.size === undefined ? '' : String(raw.size);
  if (size && !/^(auto|\d{2,5}x\d{2,5}|\d{1,2}:\d{1,2})$/.test(size)) {
    throw new GenerationGatewayError(400, 'INVALID_PARAMETERS', 'size 参数无效');
  }
  const quality = raw.quality === undefined ? '' : String(raw.quality);
  if (quality && !['auto', 'low', 'medium', 'high', 'standard', 'hd'].includes(quality)) {
    throw new GenerationGatewayError(400, 'INVALID_PARAMETERS', 'quality 参数无效');
  }
  const background = raw.background === undefined ? '' : String(raw.background);
  if (background && !['auto', 'transparent', 'opaque'].includes(background)) {
    throw new GenerationGatewayError(400, 'INVALID_PARAMETERS', 'background 参数无效');
  }
  const outputFormat = raw.outputFormat === undefined ? '' : String(raw.outputFormat);
  if (outputFormat && !['png', 'jpeg', 'webp'].includes(outputFormat)) {
    throw new GenerationGatewayError(400, 'INVALID_PARAMETERS', 'outputFormat 参数无效');
  }
  return {
    ...(size ? { size } : {}),
    ...(quality ? { quality } : {}),
    ...(raw.n === undefined ? {} : { n: Math.floor(finiteNumber(raw.n, 'n', 1, 4)) }),
    ...(background ? { background } : {}),
    ...(outputFormat ? { outputFormat } : {}),
  };
}

function normalizeReferences(value: unknown): GenerationReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', '引用文件列表无效');
  }
  return value.map((item) => {
    const reference = objectValue(item, '引用文件');
    return {
      uploadId: stringValue(reference.uploadId, 'uploadId', 120),
      role: stringValue(reference.role, '引用文件角色', 40),
    };
  });
}

export function parseCreateRequest(body: unknown): CreateGenerationTaskRequest {
  const source = objectValue(body, '请求体');
  assertNoRouteOverrides(source);
  const serialized = JSON.stringify(source);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
    throw new GenerationGatewayError(413, 'INPUT_TOO_LARGE', '请求体过大');
  }
  const operation = source.operation;
  if (!['text', 'image', 'video', 'audio'].includes(String(operation))) {
    throw new GenerationGatewayError(400, 'INVALID_REQUEST', '生成类型无效');
  }
  if (operation === 'video' || operation === 'audio') {
    throw new GenerationGatewayError(
      501,
      'OPERATION_NOT_MIGRATED',
      '该生成类型将在 B2 接入服务端任务网关'
    );
  }
  const normalizedOperation = operation as GenerationOperation;
  const rawInput = objectValue(source.input, 'input');
  const rawParameters =
    source.parameters === undefined ? {} : objectValue(source.parameters, 'parameters');
  const rawContext =
    source.context === undefined ? {} : objectValue(source.context, 'context');
  const context: CreateGenerationTaskRequest['context'] = {};
  if (rawContext.parentTaskId !== undefined) {
    context.parentTaskId = stringValue(rawContext.parentTaskId, 'parentTaskId', 120);
  }
  if (rawContext.workflowId !== undefined) {
    context.workflowId = stringValue(rawContext.workflowId, 'workflowId', 120);
  }
  return {
    modelId: stringValue(source.modelId, 'modelId', 180),
    operation: normalizedOperation,
    input:
      normalizedOperation === 'text'
        ? normalizeTextInput(rawInput)
        : normalizeImageInput(rawInput),
    parameters: normalizeParameters(normalizedOperation, rawParameters),
    references: normalizeReferences(source.references),
    context,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

export function generationRequestHash(request: CreateGenerationTaskRequest): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(request)))
    .digest('hex');
}

export function validateIdempotencyKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    throw new GenerationGatewayError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key 格式无效'
    );
  }
  return key;
}

