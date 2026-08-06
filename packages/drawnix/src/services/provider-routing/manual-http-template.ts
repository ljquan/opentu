import type {
  ManualHttpFormField,
  ManualHttpResponsePaths,
  ManualHttpTemplateMetadata,
  ModelRef,
} from '../../utils/settings-types';
import type { GeminiMessage, GeminiResponse } from '../../utils/gemini-api/types';
import type { ImageGenerationResult } from '../model-adapters/types';
import {
  base64ToBlob,
  getFileExtension,
  normalizeImageDataUrl,
} from '@aitu/utils';

const MAX_PATH_DEPTH = 16;
const MAX_PATH_RESULTS = 64;
const MAX_FORM_FIELDS = 64;
const MAX_FORM_FILE_ITEMS = 16;
const TEMPLATE_EXPR_RE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
const TEMPLATE_TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export type ManualHttpVariables = Record<string, unknown>;

export interface ManualTaskResult {
  taskId?: string;
  status?: string;
  progress?: number;
  resultUrl?: string;
  resultUrls?: string[];
  audioUrl?: string;
  audioUrls?: string[];
  error?: string;
  raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizePathToken(token: string): string[] {
  const result: string[] = [];
  const re = /([^[.\]]+)|\[(\d+|\*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(token))) {
    result.push(match[1] ?? match[2]);
  }
  return result;
}

function tokenizePath(path: string): string[] {
  return path
    .trim()
    .split('.')
    .flatMap((part) => normalizePathToken(part))
    .filter(Boolean)
    .slice(0, MAX_PATH_DEPTH);
}

function resolveVariable(name: string, variables: ManualHttpVariables): unknown {
  const normalized = name.trim();
  if (!normalized) return undefined;
  if (Object.prototype.hasOwnProperty.call(variables, normalized)) {
    return variables[normalized];
  }

  const path = tokenizePath(normalized);
  if (path.length === 0) return undefined;
  return getPathValues(variables, path.join('.'))[0];
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function renderTemplate<T = unknown>(
  input: T,
  variables: ManualHttpVariables
): T {
  if (typeof input === 'string') {
    const pureMatch = input.match(TEMPLATE_EXPR_RE);
    if (pureMatch) {
      return resolveVariable(pureMatch[1], variables) as T;
    }

    return input.replace(TEMPLATE_TOKEN_RE, (_match, name) =>
      stringifyTemplateValue(resolveVariable(name, variables))
    ) as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => renderTemplate(item, variables)) as T;
  }

  if (isRecord(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        renderTemplate(value, variables),
      ])
    ) as T;
  }

  return input;
}

function getPathValues(data: unknown, path?: string): unknown[] {
  const normalized = path?.trim();
  if (!normalized) return [];

  let current: unknown[] = [data];
  for (const token of tokenizePath(normalized)) {
    const next: unknown[] = [];
    for (const item of current) {
      if (token === '*') {
        if (Array.isArray(item)) {
          next.push(...item.slice(0, MAX_PATH_RESULTS - next.length));
        } else if (isRecord(item)) {
          next.push(
            ...Object.values(item).slice(0, MAX_PATH_RESULTS - next.length)
          );
        }
      } else if (Array.isArray(item) && /^\d+$/.test(token)) {
        const value = item[Number(token)];
        if (value !== undefined) next.push(value);
      } else if (isRecord(item)) {
        const value = item[token];
        if (value !== undefined) next.push(value);
      }

      if (next.length >= MAX_PATH_RESULTS) break;
    }
    current = next;
    if (current.length === 0) break;
  }

  return current.slice(0, MAX_PATH_RESULTS);
}

export function getByPath(data: unknown, path?: string): unknown {
  const values = getPathValues(data, path);
  if (path?.includes('*')) {
    return values;
  }
  return values.length <= 1 ? values[0] : values;
}

function parseBodyTemplate(bodyTemplate: string): unknown {
  const trimmed = bodyTemplate.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function buildManualHttpRequestBody(
  bodyTemplate: string | undefined,
  variables: ManualHttpVariables
): unknown {
  if (!bodyTemplate?.trim()) {
    return undefined;
  }

  return renderTemplate(parseBodyTemplate(bodyTemplate), variables);
}

function getBlobExtension(blob: Blob, source: string): string {
  const sourceExtension = getFileExtension(source, blob.type);
  if (sourceExtension && sourceExtension !== 'bin') {
    return sourceExtension;
  }

  const mimeExtension = getFileExtension('', blob.type || 'image/png');
  return mimeExtension === 'bin' ? 'png' : mimeExtension;
}

async function valueToBlob(
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
    throw new Error(`自定义接口文件读取失败: ${response.status}`);
  }

  const blob = await response.blob();
  return {
    blob,
    filename: `${filenamePrefix}.${getBlobExtension(blob, normalized)}`,
  };
}

function shouldOmitFormValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function expandFormFieldValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_FORM_FILE_ITEMS);
  }
  return [value];
}

function appendTextFormField(
  formData: FormData,
  fieldName: string,
  value: unknown
): void {
  if (shouldOmitFormValue(value)) {
    return;
  }
  if (typeof value === 'string') {
    formData.append(fieldName, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    formData.append(fieldName, String(value));
    return;
  }
  formData.append(fieldName, JSON.stringify(value));
}

async function appendFileFormField(
  formData: FormData,
  field: ManualHttpFormField,
  value: unknown,
  index: number,
  fetcher?: typeof fetch
): Promise<void> {
  if (typeof value !== 'string' || !value.trim()) {
    return;
  }

  const filenamePrefix =
    field.filename?.trim() ||
    field.name.replace(/\[\]$/, '').replace(/[^\w.-]+/g, '-') ||
    'file';
  const { blob, filename } = await valueToBlob(
    value,
    index > 0 ? `${filenamePrefix}-${index + 1}` : filenamePrefix,
    fetcher
  );
  formData.append(field.name, blob, filename);
}

export async function buildManualHttpFormData(
  fields: ManualHttpFormField[] | undefined,
  variables: ManualHttpVariables,
  fetcher?: typeof fetch
): Promise<FormData> {
  const formData = new FormData();
  for (const field of (fields || []).slice(0, MAX_FORM_FIELDS)) {
    const name = field.name?.trim();
    if (!name) {
      continue;
    }

    const rendered = renderTemplate(field.value ?? '', variables);
    const kind = field.kind || 'text';
    if (kind === 'text') {
      appendTextFormField(formData, name, rendered);
      continue;
    }

    const values =
      kind === 'file-list' ? expandFormFieldValue(rendered) : [rendered];
    for (let index = 0; index < values.length; index += 1) {
      await appendFileFormField(
        formData,
        { ...field, name },
        values[index],
        index,
        fetcher
      );
    }
  }

  return formData;
}

export async function buildManualHttpRequestPayload(
  template: ManualHttpTemplateMetadata,
  variables: ManualHttpVariables,
  fetcher?: typeof fetch
): Promise<{
  body: BodyInit | undefined;
  contentType?: string;
}> {
  const bodyType = template.bodyType || 'json';
  if (bodyType === 'none') {
    return { body: undefined };
  }

  if (bodyType === 'form-data') {
    return {
      body: await buildManualHttpFormData(template.formFields, variables, fetcher),
    };
  }

  const body = buildManualHttpRequestBody(template.bodyTemplate, variables);
  if (body === undefined) {
    return { body: undefined };
  }

  if (typeof body === 'string' || body instanceof FormData) {
    return {
      body,
      contentType:
        bodyType === 'raw' && typeof body === 'string'
          ? 'text/plain;charset=UTF-8'
          : undefined,
    };
  }

  return {
    body: JSON.stringify(body),
    contentType: 'application/json',
  };
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }
  return undefined;
}

function stringList(values: unknown[]): string[] {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_PATH_RESULTS);
}

function numberValue(values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const match = value.match(/(\d+(?:\.\d+)?)%?/);
      if (match) return Number(match[1]);
    }
  }
  return undefined;
}

function normalizeUrl(url: string): string {
  return normalizeImageDataUrl(url);
}

function pathValues(data: unknown, path?: string): unknown[] {
  return path ? getPathValues(data, path) : [];
}

export function normalizeManualTextResponse(
  payload: unknown,
  paths?: ManualHttpResponsePaths
): GeminiResponse {
  const content =
    firstString(pathValues(payload, paths?.text)) ||
    firstString(getPathValues(payload, 'choices.0.message.content')) ||
    firstString(getPathValues(payload, 'response')) ||
    firstString(getPathValues(payload, 'text')) ||
    (typeof payload === 'string' ? payload : JSON.stringify(payload));

  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: content || '',
        },
      },
    ],
  };
}

export function normalizeManualImageResponse(
  payload: unknown,
  paths?: ManualHttpResponsePaths
): ImageGenerationResult {
  const urls = [
    ...stringList(pathValues(payload, paths?.imageUrls)),
    ...stringList(pathValues(payload, paths?.imageUrl)),
    ...stringList(getPathValues(payload, 'data.*.url')),
    ...stringList(getPathValues(payload, 'url')),
  ].map(normalizeUrl);
  const b64Urls = [
    ...stringList(pathValues(payload, paths?.b64Json)),
    ...stringList(getPathValues(payload, 'data.*.b64_json')),
    ...stringList(getPathValues(payload, 'b64_json')),
  ].map(normalizeUrl);
  const allUrls = [...urls, ...b64Urls].filter(Boolean);
  const uniqueUrls = Array.from(new Set(allUrls));
  const primaryUrl = uniqueUrls[0];
  if (!primaryUrl) {
    throw new Error('自定义接口未按配置返回图片 URL');
  }

  const format = getFileExtension(primaryUrl) || 'png';
  return {
    url: primaryUrl,
    urls: uniqueUrls.length > 1 ? uniqueUrls : undefined,
    format: format === 'bin' ? 'png' : format,
    raw: payload,
  };
}

export function normalizeManualTaskResponse(
  payload: unknown,
  paths?: ManualHttpResponsePaths
): ManualTaskResult {
  const resultUrls = [
    ...stringList(pathValues(payload, paths?.resultUrls)),
    ...stringList(pathValues(payload, paths?.resultUrl)),
    ...stringList(getPathValues(payload, 'video_url')),
    ...stringList(getPathValues(payload, 'url')),
    ...stringList(getPathValues(payload, 'data.*.url')),
  ].map(normalizeUrl);
  const audioUrls = [
    ...stringList(pathValues(payload, paths?.audioUrls)),
    ...stringList(pathValues(payload, paths?.audioUrl)),
    ...stringList(getPathValues(payload, 'clips.*.audio_url')),
    ...stringList(getPathValues(payload, 'data.clips.*.audio_url')),
  ];

  return {
    taskId:
      firstString(pathValues(payload, paths?.taskId)) ||
      firstString(getPathValues(payload, 'taskId')) ||
      firstString(getPathValues(payload, 'task_id')) ||
      firstString(getPathValues(payload, 'id')) ||
      undefined,
    status:
      firstString(pathValues(payload, paths?.status)) ||
      firstString(getPathValues(payload, 'status')) ||
      firstString(getPathValues(payload, 'state')) ||
      undefined,
    progress:
      numberValue(pathValues(payload, paths?.progress)) ??
      numberValue(getPathValues(payload, 'progress')),
    resultUrl: resultUrls[0],
    resultUrls: resultUrls.length > 1 ? resultUrls : undefined,
    audioUrl: audioUrls[0],
    audioUrls: audioUrls.length > 1 ? audioUrls : undefined,
    error:
      firstString(pathValues(payload, paths?.error)) ||
      firstString(getPathValues(payload, 'error.message')) ||
      firstString(getPathValues(payload, 'error')) ||
      firstString(getPathValues(payload, 'message')) ||
      undefined,
    raw: payload,
  };
}

export function normalizeManualHttpResult(
  payload: unknown,
  paths?: ManualHttpResponsePaths & {
    url?: string;
    b64_json?: string;
  },
  kind?: 'text' | 'image' | 'task' | 'audio'
): unknown {
  const resolvedKind =
    kind ||
    (paths?.text
      ? 'text'
      : paths?.url ||
        paths?.b64_json ||
        paths?.imageUrl ||
        paths?.imageUrls ||
        paths?.b64Json
      ? 'image'
      : 'task');

  if (resolvedKind === 'text') {
    return normalizeManualTextResponse(payload, paths);
  }

  if (resolvedKind === 'image') {
    const imagePaths = {
      ...paths,
      imageUrl: paths?.imageUrl || paths?.url,
      b64Json: paths?.b64Json || paths?.b64_json,
    };
    const imageUrls = [
      ...stringList(pathValues(payload, imagePaths.imageUrls)),
      ...stringList(pathValues(payload, imagePaths.imageUrl)),
    ];
    const b64Values = stringList(pathValues(payload, imagePaths.b64Json));
    if (imageUrls.length > 0 || b64Values.length > 0) {
      return {
        data: [
          ...imageUrls.map((url) => ({ url })),
          ...b64Values.map((b64) => ({ b64_json: b64 })),
        ],
      };
    }

    const image = normalizeManualImageResponse(payload, imagePaths);
    return {
      data: (image.urls || [image.url]).map((url) =>
        url.startsWith('data:')
          ? { b64_json: url.replace(/^data:[^;]+;base64,/, '') }
          : { url }
      ),
    };
  }

  const task = normalizeManualTaskResponse(payload, paths);
  return {
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    resultUrl: task.resultUrl,
    error: task.error,
  };
}

export function getManualHttpTemplate(
  metadata?: Record<string, unknown> | null
): ManualHttpTemplateMetadata | null {
  const template = metadata?.manualHttp;
  if (!template || typeof template !== 'object' || Array.isArray(template)) {
    return null;
  }
  return template as ManualHttpTemplateMetadata;
}

export function buildManualHttpVariables(input: {
  model?: string;
  modelRef?: ModelRef | null;
  prompt?: string;
  messages?: GeminiMessage[];
  images?: string[];
  image?: string;
  maskImage?: string;
  size?: string;
  duration?: string | number;
  taskId?: string;
  params?: Record<string, unknown>;
}): ManualHttpVariables {
  const model = input.modelRef?.modelId || input.model;

  return {
    model,
    modelRef: input.modelRef || null,
    prompt: input.prompt,
    messages: input.messages,
    images: input.images,
    image: input.image || input.images?.[0],
    maskImage: input.maskImage,
    size: input.size,
    duration: input.duration,
    taskId: input.taskId,
    params: input.params || {},
  };
}
