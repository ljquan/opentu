import {
  providerTransport,
  readProviderResponseText,
} from '../provider-routing';
import { getByPath } from '../provider-routing/manual-http-template';
import type { ProviderPptExplainerResponsePaths } from '../provider-routing';
import { isPublicHttpMediaUrl } from '../../utils/virtual-media-url';
import {
  assertPptExplainerProviderRouteIsSafe,
  type PptExplainerProviderPreflightResult,
} from './provider-contract';

export type PptExplainerRemoteStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PptExplainerProviderManifest extends Record<string, unknown> {
  schemaVersion: number;
}

export interface PptExplainerProviderSlideInput {
  pageIndex: number;
  blob: Blob;
  filename?: string;
}

export type PptExplainerProviderSlideSource =
  | readonly PptExplainerProviderSlideInput[]
  | AsyncIterable<PptExplainerProviderSlideInput>;

export interface PptExplainerProviderResult {
  status: PptExplainerRemoteStatus;
  progress?: number;
  remoteId?: string;
  finalVideoUrl?: string;
  error?: string;
}

export interface PptExplainerProviderCancelResult
  extends PptExplainerProviderResult {
  attempted: boolean;
}

interface PptExplainerProviderRequestBase {
  route: PptExplainerProviderPreflightResult;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface SubmitPptExplainerProviderJobInput
  extends PptExplainerProviderRequestBase {
  manifest: PptExplainerProviderManifest;
  idempotencyKey: string;
  presentation?: Blob;
  presentationFilename?: string;
  slides?: PptExplainerProviderSlideSource;
}

export interface PollPptExplainerProviderJobInput
  extends PptExplainerProviderRequestBase {
  remoteId: string;
}

export interface CancelPptExplainerProviderJobInput
  extends PptExplainerProviderRequestBase {
  remoteId: string;
  idempotencyKey?: string;
}

export type PptExplainerProviderErrorCode =
  | 'invalid_request'
  | 'http_error'
  | 'invalid_response'
  | 'remote_failed';

export class PptExplainerProviderError extends Error {
  constructor(
    readonly code: PptExplainerProviderErrorCode,
    message: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'PptExplainerProviderError';
  }
}

const FORBIDDEN_MANIFEST_KEY_RE =
  /^(?:api[-_]?key|authorization|proxy[-_]?authorization|access[-_]?token|refresh[-_]?token|secret|cookie|set[-_]?cookie)$/i;
const SENSITIVE_HEADER_NAME_RE =
  /(?:api[-_.\s]?key|authorization|proxy[-_.\s]?authorization|access[-_.\s]?token|refresh[-_.\s]?token|token|secret|cookie|credential|password|passwd|signature)/i;
const MAX_ERROR_MESSAGE_LENGTH = 2000;

function requireSafeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PptExplainerProviderError('invalid_request', `${label}不能为空`);
  }
  const normalized = value.trim();
  if (/\r|\n|\0/.test(normalized)) {
    throw new PptExplainerProviderError(
      'invalid_request',
      `${label}包含非法字符`
    );
  }
  return normalized;
}

function sanitizeFilename(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.replace(/[\\/]/g, '-')
    .replace(/[\r\n\0]/g, '')
    .trim();
  return normalized || fallback;
}

function isBinaryValue(value: unknown): boolean {
  return (
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof FormData !== 'undefined' && value instanceof FormData) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

function assertSafeManifest(
  manifest: PptExplainerProviderManifest,
  apiKey: string
): string {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !Number.isInteger(manifest.schemaVersion) ||
    manifest.schemaVersion <= 0
  ) {
    throw new PptExplainerProviderError(
      'invalid_request',
      'PPT 讲解视频 manifest 缺少有效 schemaVersion'
    );
  }

  const seen = new WeakSet<object>();
  const stack: unknown[] = [manifest];
  while (stack.length > 0) {
    const current = stack.pop();
    if (isBinaryValue(current)) {
      throw new PptExplainerProviderError(
        'invalid_request',
        'PPT 讲解视频 manifest 不得包含 File、Blob、base64 缓冲或 FormData'
      );
    }
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) {
      throw new PptExplainerProviderError(
        'invalid_request',
        'PPT 讲解视频 manifest 不得包含循环引用'
      );
    }
    seen.add(current);

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PptExplainerProviderError(
        'invalid_request',
        'PPT 讲解视频 manifest 只能包含结构化 JSON 数据'
      );
    }
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_MANIFEST_KEY_RE.test(key)) {
        throw new PptExplainerProviderError(
          'invalid_request',
          `PPT 讲解视频 manifest 不得包含凭据字段：${key}`
        );
      }
      stack.push(child);
    }
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(manifest);
  } catch {
    throw new PptExplainerProviderError(
      'invalid_request',
      'PPT 讲解视频 manifest 不是可序列化 JSON'
    );
  }
  if (apiKey.length >= 8 && serialized.includes(apiKey)) {
    throw new PptExplainerProviderError(
      'invalid_request',
      'PPT 讲解视频 manifest 不得包含供应商凭据'
    );
  }
  return serialized;
}

function validateSlideInput(
  slide: PptExplainerProviderSlideInput,
  previousPageIndex: number
): void {
  if (!Number.isInteger(slide.pageIndex) || slide.pageIndex <= 0) {
    throw new PptExplainerProviderError(
      'invalid_request',
      'PPT 讲解视频页图 pageIndex 必须为正整数'
    );
  }
  if (!(slide.blob instanceof Blob) || slide.blob.size === 0) {
    throw new PptExplainerProviderError(
      'invalid_request',
      `PPT 讲解视频第 ${slide.pageIndex} 页缺少可用快照`
    );
  }
  if (slide.pageIndex === previousPageIndex) {
    throw new PptExplainerProviderError(
      'invalid_request',
      `PPT 讲解视频页图序号重复：${slide.pageIndex}`
    );
  }
  if (slide.pageIndex < previousPageIndex) {
    throw new PptExplainerProviderError(
      'invalid_request',
      'PPT 讲解视频异步页图必须按 pageIndex 递增提供'
    );
  }
}

function getOrderedSlideSource(
  slides: PptExplainerProviderSlideSource | undefined
): PptExplainerProviderSlideSource {
  if (!slides) return [];
  if (Array.isArray(slides)) {
    return [...slides].sort((left, right) => left.pageIndex - right.pageIndex);
  }
  return slides;
}

async function buildSubmitFormData(
  input: SubmitPptExplainerProviderJobInput
): Promise<FormData> {
  const manifest = assertSafeManifest(
    input.manifest,
    input.route.provider.apiKey
  );
  const presentationInput = input.route.requirements.presentationInput;

  if (presentationInput === 'pptx') {
    if (
      !(input.presentation instanceof Blob) ||
      input.presentation.size === 0
    ) {
      throw new PptExplainerProviderError(
        'invalid_request',
        '所选供应商需要原始 PPTX，但任务未提供可用文件'
      );
    }
  }

  const formData = new FormData();
  formData.append('manifest', manifest);
  if (presentationInput === 'pptx' && input.presentation) {
    formData.append(
      'presentation',
      input.presentation,
      sanitizeFilename(input.presentationFilename, 'presentation.pptx')
    );
  }
  if (presentationInput === 'slide_images') {
    let slideCount = 0;
    let previousPageIndex = 0;
    for await (const slide of getOrderedSlideSource(input.slides)) {
      input.signal?.throwIfAborted();
      validateSlideInput(slide, previousPageIndex);
      formData.append(
        'slides[]',
        slide.blob,
        sanitizeFilename(
          slide.filename,
          `slide-${String(slide.pageIndex).padStart(4, '0')}.png`
        )
      );
      previousPageIndex = slide.pageIndex;
      slideCount += 1;
    }
    if (slideCount === 0) {
      throw new PptExplainerProviderError(
        'invalid_request',
        '所选供应商需要有序页图，但任务没有可提交页面'
      );
    }
  }
  return formData;
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
    : value;
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectCredentialVariants(
  route: PptExplainerProviderPreflightResult
): string[] {
  const values = new Set<string>();
  const addValue = (value: string | undefined): void => {
    const normalized = value?.trim();
    if (!normalized) return;
    const decoded = decodeURIComponentSafely(normalized);
    for (const candidate of [normalized, decoded]) {
      if (!candidate) continue;
      values.add(candidate);
      for (const encode of [encodeURIComponent, encodeURI]) {
        try {
          const encoded = encode(candidate);
          values.add(encoded);
          values.add(encoded.replace(/%20/g, '+'));
        } catch {
          // The raw credential is still redacted when it contains invalid UTF-16.
        }
      }
    }
  };

  addValue(route.provider.apiKey);
  for (const [name, value] of Object.entries(
    route.provider.extraHeaders || {}
  )) {
    if (!SENSITIVE_HEADER_NAME_RE.test(name)) continue;
    addValue(value);
    addValue(value.match(/^\s*(?:bearer|basic)\s+(.+)$/i)?.[1]);
  }
  return [...values]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function redactCredentialText(
  value: string,
  route: PptExplainerProviderPreflightResult
): string {
  let result = value;
  for (const credential of collectCredentialVariants(route)) {
    result = result.replace(
      new RegExp(escapeRegExp(credential), 'gi'),
      '[redacted]'
    );
  }
  result = result
    .replace(
      /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;"']+/gi,
      '$1[redacted]'
    )
    .replace(
      /((?:api[-_]?key|access[-_]?token)\s*[:=]\s*)[^\s,;"']+/gi,
      '$1[redacted]'
    );
  return truncate(result.trim());
}

function toScalarString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map(toScalarString).find(Boolean);
  }
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function toErrorMessage(value: unknown): string | undefined {
  const scalar = toScalarString(value);
  if (scalar) return scalar;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return (
    toScalarString(record.message) ||
    toScalarString(record.error) ||
    toScalarString(record.detail) ||
    toScalarString(record.code)
  );
}

function resolveMappedValue(payload: unknown, path?: string): unknown {
  return path ? getByPath(payload, path) : undefined;
}

function normalizeStatus(
  rawStatus: unknown,
  route: PptExplainerProviderPreflightResult,
  fallback?: PptExplainerRemoteStatus
): PptExplainerRemoteStatus {
  const status = toScalarString(rawStatus)?.toLowerCase();
  if (!status && fallback) return fallback;
  if (!status) {
    throw new PptExplainerProviderError(
      'invalid_response',
      'PPT 讲解视频供应商响应缺少任务状态'
    );
  }
  const mapping = route.binding.metadata.pptExplainer.statusMapping;
  for (const normalized of [
    'queued',
    'processing',
    'completed',
    'failed',
    'cancelled',
  ] as const) {
    if (
      (mapping[normalized] || []).some(
        (candidate) => candidate.trim().toLowerCase() === status
      )
    ) {
      return normalized;
    }
  }
  throw new PptExplainerProviderError(
    'invalid_response',
    `PPT 讲解视频供应商返回未知状态：${status}`
  );
}

function normalizeProgress(
  value: unknown,
  route: PptExplainerProviderPreflightResult,
  status: PptExplainerRemoteStatus
): number | undefined {
  if (status === 'completed') return 100;
  const scalar = toScalarString(value)?.replace(/%$/, '');
  if (!scalar) return undefined;
  const parsed = Number(scalar);
  if (!Number.isFinite(parsed)) return undefined;
  const scaled =
    route.binding.metadata.pptExplainer.progressScale === 'ratio'
      ? parsed * 100
      : parsed;
  return Math.max(0, Math.min(100, scaled));
}

function normalizeFinalVideoUrl(value: unknown): string | undefined {
  const candidate = toScalarString(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.username || url.password || !isPublicHttpMediaUrl(url.toString())) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

async function readResponsePayload(
  response: Response,
  paths: ProviderPptExplainerResponsePaths,
  route: PptExplainerProviderPreflightResult,
  phase: string,
  allowEmpty = false
): Promise<unknown> {
  const text = await readProviderResponseText(response);
  let payload: unknown = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new PptExplainerProviderError(
          'invalid_response',
          `${phase}返回了无法解析的 JSON`
        );
      }
      payload = text;
    }
  } else if (!allowEmpty && response.ok) {
    throw new PptExplainerProviderError(
      'invalid_response',
      `${phase}返回空响应`
    );
  }

  if (!response.ok) {
    const mappedError = toErrorMessage(
      resolveMappedValue(payload, paths.error)
    );
    const fallbackError =
      typeof payload === 'string'
        ? payload
        : `${response.status} ${response.statusText || 'Error'}`;
    throw new PptExplainerProviderError(
      'http_error',
      `${phase}失败：HTTP ${response.status} ${redactCredentialText(
        mappedError || fallbackError,
        route
      )}`,
      response.status
    );
  }
  return payload;
}

function normalizePayload(
  payload: unknown,
  paths: ProviderPptExplainerResponsePaths,
  route: PptExplainerProviderPreflightResult,
  fallbackStatus?: PptExplainerRemoteStatus
): PptExplainerProviderResult {
  const status = normalizeStatus(
    resolveMappedValue(payload, paths.status),
    route,
    fallbackStatus
  );
  const error = toErrorMessage(resolveMappedValue(payload, paths.error));
  const finalVideoUrl = normalizeFinalVideoUrl(
    resolveMappedValue(payload, paths.finalVideoUrl)
  );
  const result: PptExplainerProviderResult = {
    status,
    progress: normalizeProgress(
      resolveMappedValue(payload, paths.progress),
      route,
      status
    ),
    remoteId: toScalarString(resolveMappedValue(payload, paths.remoteId)),
    finalVideoUrl,
    ...(error ? { error: redactCredentialText(error, route) } : {}),
  };

  if (status === 'failed') {
    throw new PptExplainerProviderError(
      'remote_failed',
      result.error || 'PPT 讲解视频供应商任务失败'
    );
  }
  if (status === 'completed' && !finalVideoUrl) {
    throw new PptExplainerProviderError(
      'invalid_response',
      'PPT 讲解视频供应商任务已完成但未返回可用的最终视频 URL'
    );
  }
  return result;
}

function fillRemoteIdTemplate(template: string, remoteId: string): string {
  const encoded = encodeURIComponent(remoteId);
  return template
    .replace(/\{remoteId\}/g, encoded)
    .replace(/\{taskId\}/g, encoded);
}

export async function submitPptExplainerProviderJob(
  input: SubmitPptExplainerProviderJobInput
): Promise<PptExplainerProviderResult & { remoteId: string }> {
  assertPptExplainerProviderRouteIsSafe(input.route);
  const idempotencyKey = requireSafeIdentifier(
    input.idempotencyKey,
    'PPT 讲解视频幂等键'
  );
  const formData = await buildSubmitFormData(input);
  assertPptExplainerProviderRouteIsSafe(input.route);
  const metadata = input.route.binding.metadata.pptExplainer;
  const response = await providerTransport.send(input.route.provider, {
    path: input.route.binding.submitPath,
    baseUrlStrategy: input.route.binding.baseUrlStrategy,
    method: 'POST',
    headers: {
      [metadata.idempotencyHeader || 'Idempotency-Key']: idempotencyKey,
    },
    body: formData,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
    controlledResponseBody: true,
  });
  const paths = metadata.responsePaths.submit;
  const payload = await readResponsePayload(
    response,
    paths,
    input.route,
    'PPT 讲解视频提交'
  );
  const result = normalizePayload(payload, paths, input.route, 'queued');
  const remoteId =
    result.remoteId ||
    toScalarString(resolveMappedValue(payload, paths.remoteId));
  if (!remoteId) {
    throw new PptExplainerProviderError(
      'invalid_response',
      'PPT 讲解视频供应商提交成功但未返回 remoteId'
    );
  }
  return { ...result, remoteId };
}

export async function pollPptExplainerProviderJob(
  input: PollPptExplainerProviderJobInput
): Promise<PptExplainerProviderResult & { remoteId: string }> {
  assertPptExplainerProviderRouteIsSafe(input.route);
  const remoteId = requireSafeIdentifier(input.remoteId, '远端任务 ID');
  const metadata = input.route.binding.metadata.pptExplainer;
  const response = await providerTransport.send(input.route.provider, {
    path: fillRemoteIdTemplate(input.route.binding.pollPathTemplate, remoteId),
    baseUrlStrategy: input.route.binding.baseUrlStrategy,
    method: 'GET',
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
    controlledResponseBody: true,
  });
  const paths = metadata.responsePaths.poll;
  const payload = await readResponsePayload(
    response,
    paths,
    input.route,
    'PPT 讲解视频状态查询'
  );
  return {
    ...normalizePayload(payload, paths, input.route),
    remoteId,
  };
}

export async function cancelPptExplainerProviderJob(
  input: CancelPptExplainerProviderJobInput
): Promise<PptExplainerProviderCancelResult> {
  assertPptExplainerProviderRouteIsSafe(input.route);
  const remoteId = requireSafeIdentifier(input.remoteId, '远端任务 ID');
  const metadata = input.route.binding.metadata.pptExplainer;
  if (!metadata.cancel) {
    return {
      attempted: false,
      remoteId,
      status: 'cancelled',
    };
  }

  const idempotencyKey = input.idempotencyKey
    ? requireSafeIdentifier(input.idempotencyKey, 'PPT 讲解视频幂等键')
    : undefined;
  const response = await providerTransport.send(input.route.provider, {
    path: fillRemoteIdTemplate(metadata.cancel.pathTemplate, remoteId),
    baseUrlStrategy: input.route.binding.baseUrlStrategy,
    method: metadata.cancel.method,
    headers: idempotencyKey
      ? {
          [metadata.idempotencyHeader || 'Idempotency-Key']: idempotencyKey,
        }
      : undefined,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    fetcher: input.fetcher,
    controlledResponseBody: true,
  });
  const paths = metadata.responsePaths.cancel || {};
  const payload = await readResponsePayload(
    response,
    paths,
    input.route,
    'PPT 讲解视频取消',
    true
  );
  return {
    attempted: true,
    ...normalizePayload(payload, paths, input.route, 'cancelled'),
    remoteId,
  };
}
