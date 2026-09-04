import {
  MAX_DECOMPOSITION_FOREGROUND_LAYERS,
  MAX_DECOMPOSITION_PROMPT_LENGTH,
  parseLayerDecompositionRequest,
  parseLayerDecompositionResponse,
  toLayerDecompositionRequestPayload,
} from './contract';
import type {
  LayerBoundingBoxTuple,
  LayerDecompositionCorrectionRequest,
  LayerDecompositionJob,
  LayerDecompositionJobStatus,
  LayerDecompositionPhase,
  LayerDecompositionPollingOptions,
  LayerDecompositionProgress,
  LayerDecompositionRequest,
  LayerDecompositionResponse,
} from './types';

export const DEFAULT_LAYER_DECOMPOSITION_API_URL = '/api/layer-decompositions';
export const MAX_LAYER_DECOMPOSITION_INPUT_BYTES = 30 * 1024 * 1024;
export const DEFAULT_LAYER_DECOMPOSITION_REQUEST_TIMEOUT_MS = 45_000;
export const DEFAULT_LAYER_DECOMPOSITION_POLL_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_LAYER_DECOMPOSITION_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_LAYER_DECOMPOSITION_MAX_POLL_INTERVAL_MS = 10_000;

const LAYER_DECOMPOSITION_STATUSES = new Set<LayerDecompositionJobStatus>([
  'pending',
  'queued',
  'running',
  'in_progress',
  'correcting',
  'completed',
  'failed',
  'cancelled',
  'stopped',
]);

export interface LayerDecompositionApiClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface LayerDecompositionSubmitOptions {
  signal?: AbortSignal;
}

export interface LayerDecompositionApiClient {
  submit(
    request: LayerDecompositionRequest,
    options?: LayerDecompositionSubmitOptions
  ): Promise<LayerDecompositionJob>;
  get(taskId: string, signal?: AbortSignal): Promise<LayerDecompositionJob>;
  poll(
    taskId: string,
    options?: LayerDecompositionPollingOptions
  ): Promise<LayerDecompositionResponse>;
  decompose(
    request: LayerDecompositionRequest,
    options?: LayerDecompositionPollingOptions
  ): Promise<LayerDecompositionResponse>;
  cancel(taskId: string, signal?: AbortSignal): Promise<void>;
  requestCorrection(
    taskId: string,
    correction: LayerDecompositionCorrectionRequest,
    signal?: AbortSignal
  ): Promise<LayerDecompositionJob>;
  correct(
    taskId: string,
    correction: LayerDecompositionCorrectionRequest,
    options?: LayerDecompositionPollingOptions
  ): Promise<LayerDecompositionResponse>;
}

class LayerDecompositionHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LayerDecompositionHttpError';
  }
}

export class LayerDecompositionCorrectionRequiredError extends Error {
  constructor(readonly taskId: string, readonly phase?: string) {
    super('分层结果需要人工修正');
    this.name = 'LayerDecompositionCorrectionRequiredError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isResultPayload(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.group_id === 'string' &&
    Array.isArray(value.data)
  );
}

function normalizeDirectResult(value: unknown): unknown {
  if (
    !isRecord(value) ||
    !isRecord(value.background) ||
    !Array.isArray(value.layers)
  ) {
    return value;
  }
  const groupId = readString(value.group_id) || readString(value.request_id);
  if (!groupId) return value;
  return {
    group_id: groupId,
    data: [value.background, ...value.layers],
    ...(value.width === undefined ? {} : { width: value.width }),
    ...(value.height === undefined ? {} : { height: value.height }),
    ...(value.quality === undefined ? {} : { quality: value.quality }),
    ...(value.decisions === undefined ? {} : { decisions: value.decisions }),
    ...(value.result_kind === undefined
      ? {}
      : { result_kind: value.result_kind }),
  };
}

function unwrapEnvelope(value: unknown, fallbackTaskId?: string): unknown {
  if (!isRecord(value)) return value;
  if (typeof value.success === 'boolean' && !value.success) {
    throw new Error(readString(value.message) || '语义分层请求失败');
  }
  if (
    typeof value.status === 'string' ||
    typeof value.task_id === 'string' ||
    typeof value.operation_id === 'string'
  ) {
    return value;
  }
  if (isRecord(value.data)) {
    const nested = value.data;
    if (
      isResultPayload(nested) ||
      (isRecord(nested.background) && Array.isArray(nested.layers)) ||
      typeof nested.task_id === 'string' ||
      typeof nested.operation_id === 'string' ||
      typeof nested.id === 'string' ||
      (fallbackTaskId !== undefined && typeof nested.status === 'string')
    ) {
      return nested;
    }
  }
  return value;
}

function parseProgress(
  value: unknown,
  status: LayerDecompositionJobStatus
): number {
  const fallback = status === 'completed' || status === 'failed' ? 100 : 0;
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error('Invalid layer decomposition job progress');
  }
  return value * 100;
}

export function parseLayerDecompositionJobResponse(
  value: unknown,
  fallbackTaskId?: string
): LayerDecompositionJob {
  const directValue = unwrapEnvelope(value, fallbackTaskId);
  const payload = normalizeDirectResult(directValue);
  if (isResultPayload(payload)) {
    const result = parseLayerDecompositionResponse(payload);
    return {
      taskId: fallbackTaskId || result.groupId,
      status: 'completed',
      progress: 100,
      result,
    };
  }
  if (!isRecord(payload)) {
    throw new Error('Invalid layer decomposition job response');
  }

  const taskId =
    readString(payload.task_id) ||
    readString(payload.operation_id) ||
    readString(payload.id) ||
    fallbackTaskId;
  if (!taskId) throw new Error('Invalid layer decomposition job task_id');
  const status = payload.status;
  if (
    typeof status !== 'string' ||
    !LAYER_DECOMPOSITION_STATUSES.has(status as LayerDecompositionJobStatus)
  ) {
    throw new Error('Invalid layer decomposition job status');
  }
  const normalizedStatus = status as LayerDecompositionJobStatus;
  const phase = payload.phase;
  if (
    phase !== undefined &&
    (typeof phase !== 'string' || !phase.trim() || phase.length > 128)
  ) {
    throw new Error('Invalid layer decomposition job phase');
  }
  const resultPayload = normalizeDirectResult(payload.result ?? payload.data);
  const result =
    resultPayload === undefined || resultPayload === null
      ? undefined
      : parseLayerDecompositionResponse(resultPayload);
  if (normalizedStatus === 'completed' && !result) {
    throw new Error('Completed layer decomposition job is missing result');
  }

  return {
    taskId,
    status: normalizedStatus,
    progress: parseProgress(payload.progress, normalizedStatus),
    ...(phase === undefined
      ? {}
      : { phase: phase.trim() as LayerDecompositionPhase }),
    ...(result === undefined ? {} : { result }),
    ...(readString(payload.error) ||
    (isRecord(payload.error) && readString(payload.error.message))
      ? {
          error:
            readString(payload.error) ||
            readString((payload.error as Record<string, unknown>).message),
        }
      : {}),
  };
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) return DEFAULT_LAYER_DECOMPOSITION_API_URL;
  if (normalized.startsWith('/')) {
    if (normalized.startsWith('//')) {
      throw new Error('语义分层 API 地址必须是 HTTP(S) 或同源绝对路径');
    }
    return normalized;
  }
  const parsed = new URL(normalized);
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('语义分层 API 地址必须是 HTTP(S) 或同源绝对路径');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function resolveLayerDecompositionApiUrl(explicitUrl?: string): string {
  const configured =
    explicitUrl || import.meta.env.VITE_LAYER_DECOMPOSITION_API_URL || '';
  return normalizeBaseUrl(configured);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isNonPublicIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  return (
    isPrivateIpv4(hostname) ||
    (parts.length === 4 &&
      Number.isInteger(parts[0]) &&
      parts[0] >= 224 &&
      parts[0] <= 255)
  );
}

function isNonPublicIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff')
  );
}

export function isPublicHttpImageSource(source: string): boolean {
  try {
    const url = new URL(source);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    const unwrappedHostname = hostname.replace(/^\[|\]$/g, '');
    return !(
      url.username ||
      url.password ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      isNonPublicIpv6(unwrappedHostname) ||
      isNonPublicIpv4(hostname) ||
      /^ff/i.test(unwrappedHostname)
    );
  } catch {
    return false;
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('语义分层请求已取消', 'AbortError');
  }
  const error = new Error('语义分层请求已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !externalSignal?.aborted) {
      throw new Error(`语义分层请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
    }
    if (externalSignal?.aborted) throw createAbortError();
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    const nestedError = isRecord(record.error) ? record.error : undefined;
    throw new LayerDecompositionHttpError(
      readString(record.message) ||
        readString(record.error) ||
        readString(nestedError?.message) ||
        `语义分层请求失败（HTTP ${response.status}）`,
      response.status
    );
  }
  return payload;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof LayerDecompositionHttpError) {
    return (
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.message.startsWith('语义分层请求超时'))
  );
}

async function imageSourceToBlob(
  source: string,
  fetcher: typeof fetch,
  signal?: AbortSignal
): Promise<Blob> {
  throwIfAborted(signal);
  const cachedBlob = await readCachedImageSource(source);
  if (cachedBlob) {
    const mimeType = await detectImageMimeType(
      cachedBlob,
      cachedBlob.type.toLowerCase(),
      source
    );
    if (!mimeType) {
      throw new Error('无法识别待分层图片格式');
    }
    return new Blob([cachedBlob], { type: mimeType });
  }
  const response = await fetchWithTimeout(
    fetcher,
    source,
    { signal, cache: 'no-store' },
    DEFAULT_LAYER_DECOMPOSITION_REQUEST_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`无法读取待分层图片（HTTP ${response.status}）`);
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > MAX_LAYER_DECOMPOSITION_INPUT_BYTES
  ) {
    throw new Error('待分层图片不能超过 30 MiB');
  }
  const declaredMimeType = (response.headers.get('content-type') || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size === 0 || blob.size > MAX_LAYER_DECOMPOSITION_INPUT_BYTES) {
      throw new Error(
        blob.size === 0 ? '待分层图片为空' : '待分层图片不能超过 30 MiB'
      );
    }
    const mimeType = await detectImageMimeType(blob, declaredMimeType, source);
    if (!mimeType) {
      throw new Error('无法识别待分层图片格式');
    }
    return new Blob([blob], { type: mimeType });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_LAYER_DECOMPOSITION_INPUT_BYTES) {
        await reader.cancel();
        throw new Error('待分层图片不能超过 30 MiB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0) throw new Error('待分层图片为空');
  const blob = new Blob(chunks, { type: declaredMimeType });
  const mimeType = await detectImageMimeType(blob, declaredMimeType, source);
  if (!mimeType) {
    throw new Error('无法识别待分层图片格式');
  }
  return new Blob([blob], { type: mimeType });
}

async function readCachedImageSource(source: string): Promise<Blob | null> {
  if (
    !source.startsWith('/') &&
    !source.startsWith('./') &&
    !source.startsWith('../') &&
    !source.startsWith('blob:')
  ) {
    return null;
  }

  try {
    const { unifiedCacheService } = await import('../unified-cache-service');
    return await unifiedCacheService.getCachedImageBlobWithThumbnailFallback(
      source
    );
  } catch {
    // Cache Storage/IndexedDB can be unavailable in private or non-secure
    // contexts; the regular fetch path remains the fallback.
    return null;
  }
}

async function detectImageMimeType(
  blob: Blob,
  declaredMimeType: string,
  source?: string
): Promise<string | null> {
  const headerBlob = blob.slice(0, 12);
  let headerBytes: ArrayBuffer;
  if (typeof headerBlob.arrayBuffer === 'function') {
    headerBytes = await headerBlob.arrayBuffer();
  } else if (typeof FileReader !== 'undefined') {
    headerBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(reader.error || new Error('读取图片头失败'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error('读取图片头失败'));
      };
      reader.readAsArrayBuffer(headerBlob);
    });
  } else {
    throw new Error('当前环境不支持读取图片数据');
  }
  const header = new Uint8Array(headerBytes);
  const isPng =
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a;
  if (isPng) return 'image/png';

  const isJpeg =
    header.length >= 3 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff;
  if (isJpeg) return 'image/jpeg';

  const text = new TextDecoder().decode(header);
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) {
    return 'image/gif';
  }
  if (
    header.length >= 12 &&
    text.slice(0, 4) === 'RIFF' &&
    text.slice(8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (header[0] === 0x42 && header[1] === 0x4d) return 'image/bmp';
  if (
    (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2a) ||
    (header[0] === 0x4d && header[1] === 0x4d && header[2] === 0x00)
  ) {
    return 'image/tiff';
  }
  if (
    header.length >= 12 &&
    text.slice(4, 8) === 'ftyp' &&
    /^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(text.slice(8, 12))
  ) {
    const brand = text.slice(8, 12);
    return brand.startsWith('hei') ? 'image/heic' : 'image/avif';
  }

  // For formats without a short, stable magic number (for example WebP,
  // GIF, AVIF, TIFF and BMP), retain an honest image/* response type. The
  // server performs the authoritative decoder validation before inference.
  if (blob.size === 0) return null;
  if (declaredMimeType.startsWith('image/')) {
    return declaredMimeType;
  }
  const extension = source
    ?.split(/[?#]/, 1)[0]
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  const extensionMimeTypes: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jp2: 'image/jp2',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    webp: 'image/webp',
  };
  if (extension && extensionMimeTypes[extension]) {
    return extensionMimeTypes[extension];
  }
  return null;
}

function imageFileName(blob: Blob): string {
  const subtype = blob.type.toLowerCase().split('/', 2)[1] || 'bin';
  const extension =
    subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]+/g, '');
  return `source.${extension || 'bin'}`;
}

async function buildSubmissionBody(
  request: LayerDecompositionRequest,
  fetcher: typeof fetch,
  signal?: AbortSignal
): Promise<{ body: BodyInit; headers?: HeadersInit }> {
  const payload = toLayerDecompositionRequestPayload(request);
  if (isPublicHttpImageSource(payload.image)) {
    return {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const blob = await imageSourceToBlob(payload.image, fetcher, signal);
  const form = new FormData();
  form.append('image', blob, imageFileName(blob));
  if (payload.prompt) form.append('prompt', payload.prompt);
  if (payload.mode) form.append('mode', payload.mode);
  form.append('max_layers', String(payload.max_layers));
  return { body: form };
}

function validateNormalizedBoundingBox(
  value: LayerBoundingBoxTuple
): LayerBoundingBoxTuple {
  if (
    value.length !== 4 ||
    value.some((coordinate) => !Number.isFinite(coordinate)) ||
    value[0] < 0 ||
    value[1] < 0 ||
    value[2] <= value[0] ||
    value[3] <= value[1] ||
    value[2] > 1_000 ||
    value[3] > 1_000
  ) {
    throw new Error('修正区域必须是 0..1000 内的有效 [x1,y1,x2,y2]');
  }
  return value;
}

function validateCorrection(
  correction: LayerDecompositionCorrectionRequest
): LayerDecompositionCorrectionRequest {
  const prompt = correction.prompt?.trim();
  if (prompt && prompt.length > MAX_DECOMPOSITION_PROMPT_LENGTH) {
    throw new Error(
      `修正提示词不能超过 ${MAX_DECOMPOSITION_PROMPT_LENGTH} 字符`
    );
  }
  if (
    correction.action !== undefined &&
    correction.action !== 'add' &&
    correction.action !== 'remove' &&
    correction.action !== 'replace'
  ) {
    throw new Error('修正操作必须是 add、remove 或 replace');
  }
  if (
    correction.layerZIndex !== undefined &&
    (!Number.isSafeInteger(correction.layerZIndex) ||
      correction.layerZIndex < 1 ||
      correction.layerZIndex > MAX_DECOMPOSITION_FOREGROUND_LAYERS)
  ) {
    throw new Error(
      `修正图层 zIndex 必须是 1..${MAX_DECOMPOSITION_FOREGROUND_LAYERS} 内的整数`
    );
  }
  if (
    !prompt &&
    correction.layerZIndex === undefined &&
    correction.boundingBox === undefined &&
    correction.mask === undefined
  ) {
    throw new Error('修正请求至少需要提示词、图层、区域或蒙版中的一项');
  }
  return {
    ...correction,
    ...(prompt ? { prompt } : { prompt: undefined }),
    ...(correction.boundingBox
      ? { boundingBox: validateNormalizedBoundingBox(correction.boundingBox) }
      : {}),
  };
}

async function buildCorrectionBody(
  correction: LayerDecompositionCorrectionRequest,
  fetcher: typeof fetch,
  signal?: AbortSignal
): Promise<{ body: BodyInit; headers?: HeadersInit }> {
  const validated = validateCorrection(correction);
  const payload = {
    ...(validated.prompt ? { prompt: validated.prompt } : {}),
    ...(validated.action ? { action: validated.action } : {}),
    ...(validated.layerZIndex === undefined
      ? {}
      : { layer_z_index: validated.layerZIndex }),
    ...(validated.boundingBox ? { bbox: validated.boundingBox } : {}),
    ...(validated.mask ? { mask: validated.mask } : {}),
  };
  if (!validated.mask || isPublicHttpImageSource(validated.mask)) {
    return {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const mask = await imageSourceToBlob(validated.mask, fetcher, signal);
  const form = new FormData();
  if (validated.prompt) form.append('prompt', validated.prompt);
  if (validated.action) form.append('action', validated.action);
  if (validated.layerZIndex !== undefined) {
    form.append('layer_z_index', String(validated.layerZIndex));
  }
  if (validated.boundingBox) {
    form.append('bbox', JSON.stringify(validated.boundingBox));
  }
  form.append('mask', mask, imageFileName(mask).replace('source', 'mask'));
  return { body: form };
}

function emitProgress(
  job: LayerDecompositionJob,
  onProgress?: (progress: LayerDecompositionProgress) => void
): void {
  onProgress?.({
    taskId: job.taskId,
    status: job.status,
    progress: job.progress,
    ...(job.phase ? { phase: job.phase } : {}),
  });
}

function requireTaskId(taskId: string): string {
  const normalized = taskId.trim();
  if (!normalized || normalized.length > 256) {
    throw new Error('语义分层任务 ID 无效');
  }
  return encodeURIComponent(normalized);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function completedResult(
  job: LayerDecompositionJob
): LayerDecompositionResponse {
  if (job.status === 'completed' && job.result) return job.result;
  if (job.status === 'failed') {
    throw new Error(job.error || '语义分层失败');
  }
  if (job.status === 'cancelled' || job.status === 'stopped') {
    throw createAbortError();
  }
  throw new Error('语义分层任务尚未完成');
}

export function createLayerDecompositionApiClient(
  options: LayerDecompositionApiClientOptions = {}
): LayerDecompositionApiClient {
  const baseUrl = resolveLayerDecompositionApiUrl(options.baseUrl);
  const fetcher = options.fetcher || fetch;
  const requestTimeoutMs = Math.max(
    1,
    options.requestTimeoutMs ?? DEFAULT_LAYER_DECOMPOSITION_REQUEST_TIMEOUT_MS
  );
  const request = async (
    url: string,
    init: RequestInit,
    fallbackTaskId?: string
  ): Promise<LayerDecompositionJob> => {
    const response = await fetchWithTimeout(
      fetcher,
      url,
      { ...init, cache: 'no-store' },
      requestTimeoutMs
    );
    return parseLayerDecompositionJobResponse(
      await readJsonResponse(response),
      fallbackTaskId
    );
  };

  const client: LayerDecompositionApiClient = {
    submit: async (input, submitOptions = {}) => {
      const validated = parseLayerDecompositionRequest({
        image: input.image,
        prompt: input.prompt,
        mode: input.mode,
        max_layers: input.maxLayers,
      });
      const body = await buildSubmissionBody(
        validated,
        fetcher,
        submitOptions.signal
      );
      return request(baseUrl, {
        method: 'POST',
        signal: submitOptions.signal,
        ...body,
      });
    },
    get: (taskId, signal) =>
      request(
        `${baseUrl}/${requireTaskId(taskId)}`,
        { method: 'GET', signal },
        taskId.trim()
      ),
    poll: async (taskId, pollingOptions = {}) => {
      const {
        signal,
        intervalMs = DEFAULT_LAYER_DECOMPOSITION_POLL_INTERVAL_MS,
        maxIntervalMs = DEFAULT_LAYER_DECOMPOSITION_MAX_POLL_INTERVAL_MS,
        timeoutMs = DEFAULT_LAYER_DECOMPOSITION_POLL_TIMEOUT_MS,
        maxConsecutiveErrors = 5,
        onProgress,
      } = pollingOptions;
      if (
        !Number.isFinite(intervalMs) ||
        !Number.isFinite(maxIntervalMs) ||
        !Number.isFinite(timeoutMs) ||
        !Number.isFinite(maxConsecutiveErrors) ||
        intervalMs < 0 ||
        maxIntervalMs < intervalMs ||
        timeoutMs <= 0 ||
        maxConsecutiveErrors < 1
      ) {
        throw new Error('语义分层轮询配置无效');
      }
      const startedAt = Date.now();
      let delay = intervalMs;
      let consecutiveErrors = 0;
      for (;;) {
        throwIfAborted(signal);
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error('语义分层任务轮询超时');
        }
        try {
          const job = await client.get(taskId, signal);
          consecutiveErrors = 0;
          emitProgress(job, onProgress);
          if (job.status === 'correcting' && job.phase === 'needs_correction') {
            throw new LayerDecompositionCorrectionRequiredError(
              job.taskId,
              job.phase
            );
          }
          if (job.status === 'completed' || job.status === 'failed') {
            return completedResult(job);
          }
          if (job.status === 'cancelled' || job.status === 'stopped') {
            throw createAbortError();
          }
        } catch (error) {
          if (
            signal?.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            throw createAbortError();
          }
          if (!isTransientError(error)) throw error;
          consecutiveErrors += 1;
          if (consecutiveErrors >= maxConsecutiveErrors) throw error;
        }
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) throw new Error('语义分层任务轮询超时');
        await sleep(Math.min(delay, remaining), signal);
        delay = Math.min(maxIntervalMs, Math.max(intervalMs, delay * 1.5));
      }
    },
    decompose: async (input, pollingOptions = {}) => {
      const job = await client.submit(input, { signal: pollingOptions.signal });
      emitProgress(job, pollingOptions.onProgress);
      if (
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'cancelled' ||
        job.status === 'stopped'
      ) {
        return completedResult(job);
      }
      return client.poll(job.taskId, pollingOptions);
    },
    cancel: async (taskId, signal) => {
      const response = await fetchWithTimeout(
        fetcher,
        `${baseUrl}/${requireTaskId(taskId)}/cancel`,
        { method: 'POST', signal, cache: 'no-store' },
        requestTimeoutMs
      );
      if (!response.ok) await readJsonResponse(response);
    },
    requestCorrection: async (taskId, correction, signal) => {
      const body = await buildCorrectionBody(correction, fetcher, signal);
      return request(
        `${baseUrl}/${requireTaskId(taskId)}/correct`,
        { method: 'POST', signal, ...body },
        taskId.trim()
      );
    },
    correct: async (taskId, correction, pollingOptions = {}) => {
      const job = await client.requestCorrection(
        taskId,
        correction,
        pollingOptions.signal
      );
      emitProgress(job, pollingOptions.onProgress);
      if (
        job.status === 'completed' ||
        job.status === 'failed' ||
        job.status === 'cancelled' ||
        job.status === 'stopped'
      ) {
        return completedResult(job);
      }
      return client.poll(job.taskId, pollingOptions);
    },
  };
  return client;
}

export const layerDecompositionApi = createLayerDecompositionApiClient();
