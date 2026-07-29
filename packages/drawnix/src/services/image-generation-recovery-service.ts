import { IMAGE_GENERATION_TIMEOUT_MS } from '../constants/TASK_CONSTANTS';
import type { GenerationParams, Task } from '../types/task.types';
import { TaskExecutionPhase, TaskStatus, TaskType } from '../types/task.types';
import { createModelRef } from '../utils/settings-manager';
import {
  providerTransport,
  resolveInvocationPlanFromRoute,
  type InvocationPlan,
  type PreparedProviderTransportRequest,
} from './provider-routing';
import {
  isTrustedTuziApiBaseUrl,
  normalizeTuziApiEndpointUrl,
  TUZI_API_REQUEST_ID_CORS_ENDPOINTS,
} from './provider-routing/tuzi-api-endpoints';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_JITTER_RATIO = 0.1;
const RECOVERY_RESULT_PATH = '/images/generations/result';
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULT_URLS = 10;
const MAX_TERMINAL_DELIVERY_ATTEMPTS = 3;
const TIMEOUT_RECOVERY_GRACE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

export const IMAGE_SUBMISSION_REQUEST_ID_PARAM = 'submissionRequestId';
export const IMAGE_SUBMISSION_ATTEMPTED_PARAM = 'imageSubmissionAttempted';
export const IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM =
  'imageTimeoutRecoveryAttemptedAt';
export const IMAGE_TIMEOUT_RECOVERY_ERROR_CODES = [
  'TIMEOUT',
  'RECOVERY_TIMEOUT',
] as const;

export type ImageGenerationRecoveryTask = Pick<
  Task,
  | 'id'
  | 'type'
  | 'status'
  | 'params'
  | 'createdAt'
  | 'startedAt'
  | 'remoteId'
  | 'invocationRoute'
  | 'executionPhase'
>;

export interface ImageGenerationRecoverySuccess {
  status: 'succeeded';
  requestId: string;
  url: string;
  urls: string[];
  created?: number;
}

export type ImageGenerationRecoveryFailureKind =
  | 'upstream'
  | 'authentication'
  | 'timeout'
  | 'configuration'
  | 'protocol';

export interface ImageGenerationRecoveryFailure {
  status: 'failed';
  kind: ImageGenerationRecoveryFailureKind;
  code: string;
  message: string;
  upstreamCode?: string;
  httpStatus?: number;
}

export interface ImageGenerationRecoveryCallbacks {
  onSucceeded(result: ImageGenerationRecoverySuccess): void | Promise<void>;
  onFailed(error: ImageGenerationRecoveryFailure): void | Promise<void>;
}

export interface ImageGenerationRecoveryHandle {
  readonly taskId: string;
  stop(): void;
}

type InvocationResolver = typeof resolveInvocationPlanFromRoute;
type RequestPreparer = Pick<typeof providerTransport, 'prepareRequest'>;

export interface ImageGenerationRecoveryServiceOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
  timeoutRecoveryWindowMs?: number;
  jitterRatio?: number;
  now?: () => number;
  random?: () => number;
  fetcher?: typeof fetch;
  resolveInvocationPlan?: InvocationResolver;
  transport?: RequestPreparer;
}

interface RecoveryRouteDescriptor {
  providerProfileId: string;
  modelId: string;
  bindingId?: string;
}

interface RecoveryTaskDescriptor {
  taskId: string;
  requestId: string;
  startedAt: number;
  deadline: number;
  extended: boolean;
  route: RecoveryRouteDescriptor;
}

type RecoveryEntryState = 'queued' | 'inflight' | 'waiting' | 'stopped';

interface RecoveryEntry {
  task: RecoveryTaskDescriptor | null;
  callbacks: ImageGenerationRecoveryCallbacks | null;
  state: RecoveryEntryState;
  failureStreak: number;
  terminalDeliveryAttempts: number;
  pollTimer?: ReturnType<typeof setTimeout>;
  requestTimer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
}

interface ProcessingOutcome {
  type: 'processing';
}

interface TransientOutcome {
  type: 'transient';
}

interface StoppedOutcome {
  type: 'stopped';
}

interface SuccessOutcome {
  type: 'succeeded';
  result: ImageGenerationRecoverySuccess;
}

interface FailureOutcome {
  type: 'failed';
  error: ImageGenerationRecoveryFailure;
}

type PollOutcome =
  | ProcessingOutcome
  | TransientOutcome
  | StoppedOutcome
  | SuccessOutcome
  | FailureOutcome;

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeRequestId(value: unknown): string | null {
  const requestId = normalizeRequiredString(value);
  if (!requestId || requestId.length > 191) {
    return null;
  }

  for (const character of requestId) {
    const code = character.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) {
      return null;
    }
  }

  return requestId;
}

export function getImageSubmissionRequestId(
  task: Pick<Task, 'id' | 'params'>
): string {
  return (
    normalizeRequestId(task.params[IMAGE_SUBMISSION_REQUEST_ID_PARAM]) ||
    task.id
  );
}

export function hasImageSubmissionAttempt(task: Pick<Task, 'params'>): boolean {
  return task.params[IMAGE_SUBMISSION_ATTEMPTED_PARAM] === true;
}

export function createImageSubmissionParams(
  params: GenerationParams,
  requestId: string,
  attempted = false
): GenerationParams {
  const {
    [IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM]: _timeoutRecoveryAttemptedAt,
    ...nextParams
  } = params;
  return {
    ...nextParams,
    [IMAGE_SUBMISSION_REQUEST_ID_PARAM]: requestId,
    [IMAGE_SUBMISSION_ATTEMPTED_PARAM]: attempted,
  };
}

export function isAmbiguousImageSubmissionError(error: unknown): boolean {
  const record = asRecord(error);
  const httpStatus =
    typeof record?.httpStatus === 'number'
      ? record.httpStatus
      : typeof record?.status === 'number'
      ? record.status
      : undefined;

  if (httpStatus !== undefined) {
    if ([400, 401, 403, 404, 409, 422, 429].includes(httpStatus)) {
      return false;
    }
    if (
      httpStatus === 408 ||
      [500, 502, 503, 504, 520, 522, 524].includes(httpStatus)
    ) {
      return true;
    }
  }

  const name = normalizeRequiredString(record?.name) || '';
  const message =
    normalizeRequiredString(record?.message) || String(error || '');
  const text = `${name} ${message}`;

  if (
    /invalid api|api key|credential|unauthorized|forbidden|quota|balance|rate.?limit|model.?not.?found|moderation|safety|content policy|invalid (?:prompt|parameter)|no .*adapter|未配置|无效|余额|额度|限流|审核|安全策略|参数错误/i.test(
      text
    )
  ) {
    return false;
  }

  return /AbortError|TimeoutError|failed to fetch|fetch failed|load failed|networkerror|connectionterminated|remoteprotocolerror|remote protocol|connection reset|socket hang up|unexpected (?:end|eof)|body stream|response (?:closed|lost)|\b50[234]\b|\b52[024]\b|超时|连接.*(?:中断|断开|重置)|网络错误/i.test(
    text
  );
}

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalizeUpstreamCode(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeRemoteImageUrl(value: unknown): string | null {
  const url = normalizeRequiredString(value);
  if (!url || url.length > 8_192) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripRequestIdHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const entries = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() !== 'x-request-id'
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isNodeFallbackStatus(status: number): boolean {
  return (
    status === 404 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function isSynchronousImagePlan(plan: InvocationPlan): boolean {
  const protocol = plan.binding.protocol;
  return (
    protocol === 'openai.images.generations' ||
    protocol === 'openai.images.edits'
  );
}

function createTimeoutFailure(): ImageGenerationRecoveryFailure {
  return {
    status: 'failed',
    kind: 'timeout',
    code: 'RECOVERY_TIMEOUT',
    message: '暂未查询到上游结果，可重试',
  };
}

async function readLimitedJson(response: Response): Promise<unknown> {
  if (!response.body) {
    return response.json();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('图片恢复接口响应过大');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function releaseResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 释放失败不应阻断下一可信节点的查询。
  }
}

/**
 * 通过稳定 Request ID 恢复可信 Tuzi 图片任务。
 *
 * 服务仅保存任务 ID、原调用路由和截止时间，不复制任务图片参数或 API Key。
 * 每轮查询都会重新解析原 profile，以使用用户当前配置中的凭据。
 */
export class ImageGenerationRecoveryService {
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly requestTimeoutMs: number;
  private readonly timeoutRecoveryWindowMs: number;
  private readonly jitterRatio: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly fetcher: typeof fetch;
  private readonly resolveInvocationPlan: InvocationResolver;
  private readonly transport: RequestPreparer;

  private readonly entries = new Map<string, RecoveryEntry>();
  private queue: RecoveryEntry[] = [];
  private activeQueries = 0;

  constructor(options: ImageGenerationRecoveryServiceOptions = {}) {
    this.concurrency = Math.max(
      1,
      Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY)
    );
    this.pollIntervalMs = Math.max(
      0,
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    );
    this.maxBackoffMs = Math.max(
      this.pollIntervalMs,
      options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    );
    this.requestTimeoutMs = Math.max(
      1,
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    );
    this.timeoutRecoveryWindowMs = Math.max(
      1,
      options.timeoutRecoveryWindowMs ?? TIMEOUT_RECOVERY_GRACE_MS
    );
    this.jitterRatio = Math.min(
      0.5,
      Math.max(0, options.jitterRatio ?? DEFAULT_JITTER_RATIO)
    );
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.fetcher = options.fetcher ?? fetch;
    this.resolveInvocationPlan =
      options.resolveInvocationPlan ?? resolveInvocationPlanFromRoute;
    this.transport = options.transport ?? providerTransport;
  }

  canRecover(task: ImageGenerationRecoveryTask): boolean {
    const descriptor = this.createTaskDescriptor(task);
    return Boolean(
      descriptor &&
        descriptor.deadline > this.now() &&
        this.resolveTrustedInvocationPlan(descriptor)
    );
  }

  canRecoverTimedOut(task: Task): boolean {
    const startedAt = normalizePositiveNumber(task.startedAt ?? task.createdAt);
    const failedAt =
      task.status === TaskStatus.PROCESSING && startedAt !== undefined
        ? startedAt + IMAGE_GENERATION_TIMEOUT_MS
        : normalizePositiveNumber(
            task.completedAt ?? task.error?.details?.timestamp ?? task.updatedAt
          );
    const elapsed =
      failedAt === undefined ? Number.POSITIVE_INFINITY : this.now() - failedAt;
    const timeoutRecoveryStartedAt = normalizePositiveNumber(
      task.params[IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM]
    );
    const isFailedTimeout =
      task.status === TaskStatus.FAILED &&
      IMAGE_TIMEOUT_RECOVERY_ERROR_CODES.some(
        (code) => code === task.error?.code
      );
    const isExpiredProcessing =
      task.status === TaskStatus.PROCESSING && elapsed >= 0;
    if (
      task.type !== TaskType.IMAGE ||
      (!isFailedTimeout && !isExpiredProcessing) ||
      task.remoteId ||
      task.syncedFromRemote ||
      elapsed < -CLOCK_SKEW_TOLERANCE_MS ||
      (timeoutRecoveryStartedAt === undefined &&
        elapsed > TIMEOUT_RECOVERY_GRACE_MS) ||
      (timeoutRecoveryStartedAt !== undefined &&
        (task.status !== TaskStatus.FAILED ||
          timeoutRecoveryStartedAt + this.timeoutRecoveryWindowMs <=
            this.now()))
    ) {
      return false;
    }

    const descriptor = this.createTaskDescriptor(task, true);
    return Boolean(descriptor && this.resolveTrustedInvocationPlan(descriptor));
  }

  start(
    task: ImageGenerationRecoveryTask,
    callbacks: ImageGenerationRecoveryCallbacks
  ): ImageGenerationRecoveryHandle | null {
    const descriptor = this.createTaskDescriptor(task);
    if (
      !descriptor ||
      descriptor.deadline <= this.now() ||
      !this.resolveTrustedInvocationPlan(descriptor)
    ) {
      return null;
    }

    const currentEntry = this.entries.get(descriptor.taskId);
    if (
      currentEntry?.task?.requestId === descriptor.requestId &&
      currentEntry.task.startedAt === descriptor.startedAt &&
      currentEntry.state !== 'stopped'
    ) {
      currentEntry.callbacks = callbacks;
      return Object.freeze({
        taskId: descriptor.taskId,
        stop: () => this.stopEntry(currentEntry),
      });
    }

    this.stop(descriptor.taskId);

    const entry: RecoveryEntry = {
      task: descriptor,
      callbacks,
      state: 'queued',
      failureStreak: 0,
      terminalDeliveryAttempts: 0,
    };
    this.entries.set(descriptor.taskId, entry);
    this.queue.push(entry);
    this.drainQueue();

    return Object.freeze({
      taskId: descriptor.taskId,
      stop: () => this.stopEntry(entry),
    });
  }

  stop(taskId: string): void {
    const entry = this.entries.get(taskId);
    if (entry) {
      this.stopEntry(entry);
    }
  }

  stopAll(): void {
    const entries = [...this.entries.values()];
    for (const entry of entries) {
      this.stopEntry(entry, false);
    }
    this.queue = [];
  }

  private createTaskDescriptor(
    task: ImageGenerationRecoveryTask,
    forceExtended = false
  ): RecoveryTaskDescriptor | null {
    if (task.type !== TaskType.IMAGE) {
      return null;
    }

    const taskId = normalizeRequestId(task.id);
    const requestId = normalizeRequestId(getImageSubmissionRequestId(task));
    const route = task.invocationRoute;
    const providerProfileId = normalizeRequiredString(route?.providerProfileId);
    const modelId = normalizeRequiredString(
      route?.modelRef?.modelId || route?.modelId
    );
    const startedAt = normalizePositiveNumber(task.startedAt ?? task.createdAt);
    const timeoutRecoveryStartedAt = normalizePositiveNumber(
      task.params[IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM]
    );
    const extended = forceExtended || timeoutRecoveryStartedAt !== undefined;
    const now = this.now();

    if (
      !taskId ||
      !requestId ||
      route?.operation !== 'image' ||
      !providerProfileId ||
      !modelId ||
      startedAt === undefined ||
      (timeoutRecoveryStartedAt !== undefined &&
        timeoutRecoveryStartedAt > now + CLOCK_SKEW_TOLERANCE_MS) ||
      !hasImageSubmissionAttempt(task)
    ) {
      return null;
    }

    return {
      taskId,
      requestId,
      startedAt,
      deadline: extended
        ? (timeoutRecoveryStartedAt ?? now) + this.timeoutRecoveryWindowMs
        : Math.min(startedAt, now) + IMAGE_GENERATION_TIMEOUT_MS,
      extended,
      route: {
        providerProfileId,
        modelId,
        bindingId: normalizeRequiredString(route.binding?.id) || undefined,
      },
    };
  }

  private resolveTrustedInvocationPlan(
    task: RecoveryTaskDescriptor
  ): InvocationPlan | null {
    const modelRef = createModelRef(
      task.route.providerProfileId,
      task.route.modelId
    );
    if (!modelRef) {
      return null;
    }

    const plan = this.resolveInvocationPlan('image', modelRef, {
      bindingId: task.route.bindingId,
    });
    if (
      !plan ||
      plan.provider.profileId !== task.route.providerProfileId ||
      !plan.provider.apiKey?.trim() ||
      !isTrustedTuziApiBaseUrl(plan.provider.baseUrl) ||
      !isSynchronousImagePlan(plan)
    ) {
      return null;
    }

    return plan;
  }

  private isCurrent(entry: RecoveryEntry): boolean {
    const taskId = entry.task?.taskId;
    return Boolean(taskId && this.entries.get(taskId) === entry);
  }

  private drainQueue(): void {
    while (this.activeQueries < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry || entry.state !== 'queued' || !this.isCurrent(entry)) {
        continue;
      }

      entry.state = 'inflight';
      this.activeQueries += 1;
      void this.runEntry(entry).finally(() => {
        this.activeQueries = Math.max(0, this.activeQueries - 1);
        this.drainQueue();
      });
    }
  }

  private async runEntry(entry: RecoveryEntry): Promise<void> {
    const task = entry.task;
    if (!task || !this.isCurrent(entry)) {
      return;
    }
    if (task.deadline <= this.now()) {
      this.finishFailure(entry, createTimeoutFailure());
      return;
    }

    let outcome: PollOutcome;
    try {
      outcome = await this.queryNodes(entry, task);
    } catch {
      outcome = { type: 'transient' };
    }

    if (!this.isCurrent(entry)) {
      return;
    }

    switch (outcome.type) {
      case 'succeeded':
        this.finishSuccess(entry, outcome.result);
        return;
      case 'failed':
        this.finishFailure(entry, outcome.error);
        return;
      case 'stopped':
        return;
      case 'processing':
        entry.failureStreak = 0;
        this.scheduleNextPoll(entry);
        return;
      case 'transient':
        entry.failureStreak += 1;
        this.scheduleNextPoll(entry);
        return;
    }
  }

  private async queryNodes(
    entry: RecoveryEntry,
    task: RecoveryTaskDescriptor
  ): Promise<PollOutcome> {
    const plan = this.resolveTrustedInvocationPlan(task);
    if (!plan) {
      return {
        type: 'failed',
        error: {
          status: 'failed',
          kind: 'configuration',
          code: 'RECOVERY_ROUTE_UNAVAILABLE',
          message: '原供应商配置不可用，无法继续恢复图片结果',
        },
      };
    }

    const queryTargets = this.createQueryTargets(plan);
    let sawProcessing = false;

    for (const target of queryTargets) {
      if (!this.isCurrent(entry)) {
        return { type: 'stopped' };
      }
      const remainingMs = task.deadline - this.now();
      if (remainingMs <= 0) {
        return { type: 'failed', error: createTimeoutFailure() };
      }

      const controller = new AbortController();
      entry.controller = controller;
      entry.requestTimer = setTimeout(() => {
        const timeoutError = new Error('Image recovery request timed out');
        timeoutError.name = 'TimeoutError';
        controller.abort(timeoutError);
      }, Math.min(this.requestTimeoutMs, remainingMs));

      try {
        const prepared = this.prepareNodeRequest(
          plan,
          target.url,
          task.requestId,
          controller.signal
        );
        const response = await this.fetcher(prepared.url, prepared.init);

        if (!this.isCurrent(entry)) {
          return { type: 'stopped' };
        }
        if (response.status === 401 || response.status === 403) {
          await releaseResponseBody(response);
          if (target.isOriginalProvider) {
            return {
              type: 'failed',
              error: {
                status: 'failed',
                kind: 'authentication',
                code: 'RECOVERY_AUTHENTICATION_FAILED',
                message: '当前供应商凭据不可用，无法继续恢复图片结果',
                httpStatus: response.status,
              },
            };
          }
          continue;
        }
        if (isNodeFallbackStatus(response.status)) {
          await releaseResponseBody(response);
          continue;
        }
        if (!response.ok) {
          await releaseResponseBody(response);
          return {
            type: 'failed',
            error: {
              status: 'failed',
              kind: 'protocol',
              code: `RECOVERY_HTTP_${response.status}`,
              message: '上游结果查询请求失败',
              httpStatus: response.status,
            },
          };
        }

        const parsed = this.parseResponse(
          await readLimitedJson(response),
          task.requestId
        );
        if (parsed.type === 'processing') {
          sawProcessing = true;
          continue;
        }
        if (parsed.type !== 'transient') {
          return parsed;
        }
      } catch {
        if (!this.isCurrent(entry)) {
          return { type: 'stopped' };
        }
      } finally {
        if (entry.requestTimer) {
          clearTimeout(entry.requestTimer);
          entry.requestTimer = undefined;
        }
        if (entry.controller === controller) {
          entry.controller = undefined;
        }
      }
    }

    return sawProcessing ? { type: 'processing' } : { type: 'transient' };
  }

  private createQueryTargets(
    plan: InvocationPlan
  ): Array<{ url: string; isOriginalProvider: boolean }> {
    const targets = [
      { url: plan.provider.baseUrl, isOriginalProvider: true },
      ...TUZI_API_REQUEST_ID_CORS_ENDPOINTS.map((endpoint) => ({
        url: endpoint.url,
        isOriginalProvider: false,
      })),
    ];
    const seenOrigins = new Set<string>();

    return targets.filter((target) => {
      const origin = normalizeTuziApiEndpointUrl(target.url);
      if (!origin || seenOrigins.has(origin)) {
        return false;
      }
      seenOrigins.add(origin);
      return true;
    });
  }

  private prepareNodeRequest(
    plan: InvocationPlan,
    nodeUrl: string,
    requestId: string,
    signal: AbortSignal
  ): PreparedProviderTransportRequest {
    return this.transport.prepareRequest(
      {
        ...plan.provider,
        baseUrl: nodeUrl,
        extraHeaders: stripRequestIdHeaders(plan.provider.extraHeaders),
      },
      {
        path: RECOVERY_RESULT_PATH,
        method: 'GET',
        baseUrlStrategy: 'ensure-v1',
        query: { request_id: requestId },
        signal,
      }
    );
  }

  private parseResponse(payload: unknown, requestId: string): PollOutcome {
    const object = asRecord(payload);
    const status = normalizeRequiredString(object?.status);
    if (!object || !status) {
      return { type: 'transient' };
    }

    if (status === 'processing_or_not_found') {
      return { type: 'processing' };
    }

    if (status === 'succeeded') {
      const data = Array.isArray(object.data) ? object.data : [];
      const urls = data
        .map((item) => normalizeRemoteImageUrl(asRecord(item)?.url))
        .filter((url): url is string => Boolean(url));
      const uniqueUrls = [...new Set(urls)];
      if (uniqueUrls.length === 0) {
        return { type: 'transient' };
      }

      return {
        type: 'succeeded',
        result: {
          status: 'succeeded',
          requestId,
          url: uniqueUrls[0],
          urls: uniqueUrls.slice(0, MAX_RESULT_URLS),
          created: normalizePositiveNumber(object.created),
        },
      };
    }

    if (status === 'failed') {
      const upstreamError = asRecord(object.error);
      const message =
        normalizeRequiredString(upstreamError?.message) ||
        normalizeRequiredString(object.message) ||
        '上游图片生成失败';
      const upstreamCode = normalizeUpstreamCode(
        upstreamError?.code ?? object.code
      );
      return {
        type: 'failed',
        error: {
          status: 'failed',
          kind: 'upstream',
          code: upstreamCode || 'UPSTREAM_FAILED',
          upstreamCode,
          message,
        },
      };
    }

    return { type: 'transient' };
  }

  private scheduleNextPoll(entry: RecoveryEntry): void {
    const task = entry.task;
    if (!task || !this.isCurrent(entry)) {
      return;
    }

    const remainingMs = task.deadline - this.now();
    if (remainingMs <= 0) {
      this.finishFailure(entry, createTimeoutFailure());
      return;
    }

    entry.state = 'waiting';
    const delay = Math.min(
      task.extended ? this.maxBackoffMs : this.nextDelay(entry.failureStreak),
      remainingMs
    );
    entry.pollTimer = setTimeout(() => {
      entry.pollTimer = undefined;
      if (!this.isCurrent(entry)) {
        return;
      }
      if (task.deadline <= this.now()) {
        this.finishFailure(entry, createTimeoutFailure());
        return;
      }
      entry.state = 'queued';
      this.queue.push(entry);
      this.drainQueue();
    }, delay);
  }

  private nextDelay(failureStreak: number): number {
    const exponent = Math.max(0, Math.min(20, failureStreak - 1));
    const baseDelay = Math.min(
      this.maxBackoffMs,
      this.pollIntervalMs * 2 ** exponent
    );
    const random = Math.min(1, Math.max(0, this.random()));
    const jitterMultiplier = 1 + this.jitterRatio * (random * 2 - 1);
    return Math.min(
      this.maxBackoffMs,
      Math.max(0, Math.round(baseDelay * jitterMultiplier))
    );
  }

  private finishSuccess(
    entry: RecoveryEntry,
    result: ImageGenerationRecoverySuccess
  ): void {
    const callback = entry.callbacks?.onSucceeded;
    void this.deliverTerminalCallback(entry, callback, result, 'success');
  }

  private finishFailure(
    entry: RecoveryEntry,
    error: ImageGenerationRecoveryFailure
  ): void {
    const callback = entry.callbacks?.onFailed;
    void this.deliverTerminalCallback(entry, callback, error, 'failure');
  }

  private async deliverTerminalCallback<T>(
    entry: RecoveryEntry,
    callback: ((value: T) => void | Promise<void>) | undefined,
    value: T,
    terminalType: 'success' | 'failure'
  ): Promise<void> {
    if (!callback) {
      this.stopEntry(entry);
      return;
    }

    try {
      await callback(value);
      if (this.isCurrent(entry)) {
        this.stopEntry(entry);
      }
    } catch (error) {
      if (!this.isCurrent(entry)) {
        return;
      }

      entry.terminalDeliveryAttempts += 1;
      console.warn(
        `[ImageGenerationRecovery] Failed to persist recovered ${terminalType} state, retrying:`,
        error
      );
      if (entry.terminalDeliveryAttempts >= MAX_TERMINAL_DELIVERY_ATTEMPTS) {
        console.error(
          `[ImageGenerationRecovery] Giving up recovered ${terminalType} state after ${MAX_TERMINAL_DELIVERY_ATTEMPTS} attempts`
        );
        this.stopEntry(entry);
        return;
      }

      entry.state = 'waiting';
      entry.pollTimer = setTimeout(() => {
        entry.pollTimer = undefined;
        if (!this.isCurrent(entry)) {
          return;
        }
        entry.state = 'inflight';
        void this.deliverTerminalCallback(entry, callback, value, terminalType);
      }, this.pollIntervalMs);
    }
  }

  private stopEntry(entry: RecoveryEntry, removeFromQueue = true): void {
    const taskId = entry.task?.taskId;
    if (taskId && this.entries.get(taskId) === entry) {
      this.entries.delete(taskId);
    }
    if (entry.pollTimer) {
      clearTimeout(entry.pollTimer);
      entry.pollTimer = undefined;
    }
    if (entry.requestTimer) {
      clearTimeout(entry.requestTimer);
      entry.requestTimer = undefined;
    }
    entry.controller?.abort();
    entry.controller = undefined;
    entry.state = 'stopped';
    entry.task = null;
    entry.callbacks = null;

    if (removeFromQueue) {
      this.queue = this.queue.filter((queuedEntry) => queuedEntry !== entry);
    }
  }
}

export const imageGenerationRecoveryService =
  new ImageGenerationRecoveryService();

const LEGACY_RECOVERABLE_ERROR_CODES = new Set([
  'INTERRUPTED',
  'INTERRUPTED_DURING_SUBMISSION',
]);

export function isImageRequestRecoveryTask(task: Task): boolean {
  return (
    task.status === TaskStatus.PROCESSING &&
    task.executionPhase === TaskExecutionPhase.POLLING &&
    !task.remoteId &&
    !task.syncedFromRemote &&
    imageGenerationRecoveryService.canRecover(task)
  );
}

export function isTimedOutImageRequestRecoveryTask(task: Task): boolean {
  return imageGenerationRecoveryService.canRecoverTimedOut(task);
}

export function isLegacyInterruptedImageRequestTask(task: Task): boolean {
  const hasAttemptMetadata =
    task.params[IMAGE_SUBMISSION_ATTEMPTED_PARAM] !== undefined;
  const legacyTask = hasImageSubmissionAttempt(task)
    ? task
    : !hasAttemptMetadata
    ? {
        ...task,
        params: createImageSubmissionParams(
          task.params,
          getImageSubmissionRequestId(task),
          true
        ),
      }
    : null;
  if (!legacyTask) {
    return false;
  }
  return (
    task.status === TaskStatus.FAILED &&
    LEGACY_RECOVERABLE_ERROR_CODES.has(task.error?.code || '') &&
    !task.remoteId &&
    !task.syncedFromRemote &&
    imageGenerationRecoveryService.canRecover(legacyTask)
  );
}

export function shouldRecoverImageSubmission(
  task: Task,
  error: unknown
): boolean {
  return (
    task.status !== TaskStatus.CANCELLED &&
    !task.remoteId &&
    hasImageSubmissionAttempt(task) &&
    isAmbiguousImageSubmissionError(error) &&
    imageGenerationRecoveryService.canRecover(task)
  );
}

export function isCurrentImageRecoveryAttempt(
  task: Task | undefined,
  requestId: string,
  startedAt: number
): task is Task {
  return Boolean(
    task &&
      isImageRequestRecoveryTask(task) &&
      getImageSubmissionRequestId(task) === requestId &&
      task.startedAt === startedAt
  );
}
