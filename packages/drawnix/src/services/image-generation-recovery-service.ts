import { IMAGE_GENERATION_TIMEOUT_MS } from '../constants/TASK_CONSTANTS';
import type {
  GenerationParams,
  Task,
  TaskInvocationBindingSnapshot,
} from '../types/task.types';
import { TaskExecutionPhase, TaskStatus, TaskType } from '../types/task.types';
import { CryptoUtils } from '../utils/crypto-utils';
import { createModelRef } from '../utils/settings-manager';
import {
  providerTransport,
  resolveInvocationPlanFromRoute,
  type InvocationPlan,
  type PreparedProviderTransportRequest,
} from './provider-routing';
import {
  getManualHttpTemplate,
  resolveManualHttpRequestMethod,
} from './provider-routing/manual-http-template';
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
const TERMINAL_ABORT_GRACE_MS = 5_000;
const RECOVERY_RESULT_PATH = '/images/generations/result';
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULT_URLS = 10;

export const IMAGE_SUBMISSION_REQUEST_ID_PARAM = 'submissionRequestId';
const IMAGE_SUBMISSION_ATTEMPTED_PARAM = 'imageSubmissionAttempted';

type ImageGenerationRecoveryTask = Pick<
  Task,
  | 'id'
  | 'type'
  | 'status'
  | 'params'
  | 'createdAt'
  | 'startedAt'
  | 'remoteId'
  | 'syncedFromRemote'
  | 'invocationRoute'
  | 'executionPhase'
>;

interface ImageGenerationRecoverySuccess {
  status: 'succeeded';
  requestId: string;
  url: string;
  urls: string[];
  created?: number;
}

type ImageGenerationRecoveryFailureKind =
  | 'upstream'
  | 'authentication'
  | 'timeout'
  | 'configuration'
  | 'protocol';

interface ImageGenerationRecoveryFailure {
  status: 'failed';
  kind: ImageGenerationRecoveryFailureKind;
  code: string;
  message: string;
  upstreamCode?: string;
  httpStatus?: number;
}

interface ImageGenerationRecoveryCallbacks {
  onSucceeded(
    result: ImageGenerationRecoverySuccess,
    signal: AbortSignal
  ): void | Promise<void>;
  onFailed(
    error: ImageGenerationRecoveryFailure,
    signal: AbortSignal
  ): void | Promise<void>;
}

interface ImageGenerationRecoveryHandle {
  readonly taskId: string;
  stop(): void;
}

type ImageGenerationRecoveryStartFailureReason =
  | 'invalid-task'
  | 'expired'
  | 'route-unavailable';

type ImageGenerationRecoveryStartResult =
  | {
      readonly status: 'started';
      readonly handle: ImageGenerationRecoveryHandle;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ImageGenerationRecoveryStartFailureReason;
    };

type InvocationResolver = typeof resolveInvocationPlanFromRoute;
type RequestPreparer = Pick<typeof providerTransport, 'prepareRequest'>;

interface ImageGenerationRecoveryServiceOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  maxBackoffMs?: number;
  requestTimeoutMs?: number;
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
  binding: RecoveryBindingFingerprint;
}

interface RecoveryBindingFingerprint {
  protocol: string;
  method: string;
  submitPath: string;
  pollPathTemplate: string | null;
  baseUrlStrategy: 'preserve' | 'trim-v1' | 'ensure-v1';
}

interface RecoveryTaskDescriptor {
  taskId: string;
  requestId: string;
  startedAt: number;
  deadline: number;
  route: RecoveryRouteDescriptor;
}

type RecoveryEntryState = 'queued' | 'inflight' | 'waiting';

interface RecoveryEntry {
  task: RecoveryTaskDescriptor | null;
  callbacks: ImageGenerationRecoveryCallbacks | null;
  state: RecoveryEntryState;
  failureStreak: number;
  terminalDeliveryAttempts: number;
  pollTimer?: ReturnType<typeof setTimeout>;
  requestTimer?: ReturnType<typeof setTimeout>;
  terminalTimer?: ReturnType<typeof setTimeout>;
  releaseTerminalWait?: () => void;
  controller?: AbortController;
  terminalDelivery?: () => Promise<void>;
}

interface ProcessingOutcome {
  type: 'processing';
}

interface TransientOutcome {
  type: 'transient';
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
  return {
    ...params,
    [IMAGE_SUBMISSION_REQUEST_ID_PARAM]: requestId,
    [IMAGE_SUBMISSION_ATTEMPTED_PARAM]: attempted,
  };
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

function createRecoveryBindingFingerprint(
  binding:
    | Pick<
        TaskInvocationBindingSnapshot,
        | 'protocol'
        | 'submitPath'
        | 'pollPathTemplate'
        | 'baseUrlStrategy'
        | 'metadata'
      >
    | null
    | undefined
): RecoveryBindingFingerprint | null {
  const protocol = normalizeRequiredString(binding?.protocol);
  const submitPath = normalizeRequiredString(binding?.submitPath);
  const pollPathTemplate = normalizeRequiredString(binding?.pollPathTemplate);
  const baseUrlStrategy = binding?.baseUrlStrategy ?? 'preserve';
  if (
    !protocol ||
    !submitPath ||
    !['preserve', 'trim-v1', 'ensure-v1'].includes(baseUrlStrategy)
  ) {
    return null;
  }

  let method = 'POST';
  if (protocol === 'custom-http') {
    const manualHttp = getManualHttpTemplate(binding?.metadata);
    if (!manualHttp) {
      return null;
    }
    method = resolveManualHttpRequestMethod(manualHttp).toUpperCase();
  }

  return {
    protocol,
    method,
    submitPath,
    pollPathTemplate,
    baseUrlStrategy,
  };
}

function isSameRecoveryBinding(
  left: RecoveryBindingFingerprint,
  right: RecoveryBindingFingerprint
): boolean {
  return (
    left.protocol === right.protocol &&
    left.method === right.method &&
    left.submitPath === right.submitPath &&
    left.pollPathTemplate === right.pollPathTemplate &&
    left.baseUrlStrategy === right.baseUrlStrategy
  );
}

function isSynchronousImageBinding(
  binding: RecoveryBindingFingerprint
): boolean {
  const submitPath = binding.submitPath.split(/[?#]/, 1)[0] || '';
  if (
    binding.method !== 'POST' ||
    binding.pollPathTemplate ||
    !/\/images\/(?:generations|edits)\/?$/i.test(submitPath)
  ) {
    return false;
  }

  return (
    binding.protocol === 'openai.images.generations' ||
    binding.protocol === 'openai.images.edits' ||
    binding.protocol === 'custom-http'
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

async function readLimitedJson(
  response: Response,
  signal?: AbortSignal
): Promise<unknown> {
  if (!response.body) {
    signal?.throwIfAborted();
    return response.json();
  }

  const reader = response.body.getReader();
  const readBody = (async () => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          const error = new Error('图片恢复接口响应过大');
          void reader.cancel(error).catch(() => undefined);
          throw error;
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
  })();
  void readBody.catch(() => undefined);

  if (!signal) {
    return readBody;
  }

  let removeAbortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => {
      const reason =
        signal.reason ??
        Object.assign(new Error('Aborted'), {
          name: 'AbortError',
        });
      try {
        void reader.cancel(reason).catch(() => undefined);
      } catch {
        // The stream may have completed between the abort and cancellation.
      }
      reject(reason);
    };

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', abort);
  });

  try {
    return await Promise.race([readBody, aborted]);
  } finally {
    removeAbortListener();
  }
}

function releaseResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // 释放失败不应阻断下一可信节点的查询。
  }
}

async function waitForFetchResponse(
  fetchPromise: Promise<Response>,
  signal: AbortSignal
): Promise<Response> {
  void fetchPromise.then(
    (response) => {
      if (signal.aborted) {
        releaseResponseBody(response);
      }
    },
    () => undefined
  );

  let removeAbortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => {
      reject(
        signal.reason ??
          Object.assign(new Error('Aborted'), {
            name: 'AbortError',
          })
      );
    };

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', abort);
  });

  try {
    return await Promise.race([fetchPromise, aborted]);
  } finally {
    removeAbortListener();
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
    this.jitterRatio = Math.min(
      0.5,
      Math.max(0, options.jitterRatio ?? DEFAULT_JITTER_RATIO)
    );
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
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

  start(
    task: ImageGenerationRecoveryTask,
    callbacks: ImageGenerationRecoveryCallbacks
  ): ImageGenerationRecoveryStartResult {
    const descriptor = this.createTaskDescriptor(task);
    if (!descriptor) {
      return { status: 'rejected', reason: 'invalid-task' };
    }
    if (descriptor.deadline <= this.now()) {
      return { status: 'rejected', reason: 'expired' };
    }
    const plan = this.resolveTrustedInvocationPlan(descriptor);
    if (!plan) {
      return { status: 'rejected', reason: 'route-unavailable' };
    }

    const currentEntry = this.entries.get(descriptor.taskId);
    if (
      currentEntry?.task?.requestId === descriptor.requestId &&
      currentEntry.task.startedAt === descriptor.startedAt &&
      currentEntry.task.deadline === descriptor.deadline
    ) {
      currentEntry.callbacks = callbacks;
      return Object.freeze({
        status: 'started' as const,
        handle: Object.freeze({
          taskId: descriptor.taskId,
          stop: () => this.stopEntry(currentEntry),
        }),
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
      status: 'started' as const,
      handle: Object.freeze({
        taskId: descriptor.taskId,
        stop: () => this.stopEntry(entry),
      }),
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

  hasPendingTerminalWriteback(taskId: string): boolean {
    const entry = this.entries.get(taskId);
    return Boolean(
      entry?.callbacks &&
        (entry.terminalTimer ||
          entry.terminalDelivery ||
          entry.terminalDeliveryAttempts > 0)
    );
  }

  private createTaskDescriptor(
    task: ImageGenerationRecoveryTask
  ): RecoveryTaskDescriptor | null {
    if (
      task.type !== TaskType.IMAGE ||
      task.status !== TaskStatus.PROCESSING ||
      task.executionPhase !== TaskExecutionPhase.POLLING ||
      Boolean(task.remoteId) ||
      Boolean(task.syncedFromRemote)
    ) {
      return null;
    }

    const taskId = normalizeRequestId(task.id);
    const requestId = normalizeRequestId(
      task.params[IMAGE_SUBMISSION_REQUEST_ID_PARAM]
    );
    const route = task.invocationRoute;
    const providerProfileId = normalizeRequiredString(route?.providerProfileId);
    const modelId = normalizeRequiredString(
      route?.modelRef?.modelId || route?.modelId
    );
    const binding = createRecoveryBindingFingerprint(route?.binding);
    const startedAt = normalizePositiveNumber(task.startedAt ?? task.createdAt);

    if (
      !taskId ||
      !requestId ||
      route?.operation !== 'image' ||
      !providerProfileId ||
      !modelId ||
      !binding ||
      !isSynchronousImageBinding(binding) ||
      startedAt === undefined ||
      !hasImageSubmissionAttempt(task)
    ) {
      return null;
    }

    return {
      taskId,
      requestId,
      startedAt,
      deadline: startedAt + IMAGE_GENERATION_TIMEOUT_MS,
      route: {
        providerProfileId,
        modelId,
        bindingId: normalizeRequiredString(route.binding?.id) || undefined,
        binding,
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

    let plan = this.resolveInvocationPlan('image', modelRef, {
      bindingId: task.route.bindingId,
    });
    // 页面刷新后，提交时持久化的派生 binding ID 可能因设置重新初始化而变化。
    // 精确 ID 不存在时，仅在同一供应商与模型范围内重新解析，再继续执行下面的
    // 可信节点与同步图片协议校验。
    if (!plan && task.route.bindingId) {
      plan = this.resolveInvocationPlan('image', modelRef);
    }
    const resolvedBinding = plan
      ? createRecoveryBindingFingerprint(plan.binding)
      : null;
    if (
      !plan ||
      !resolvedBinding ||
      plan.provider.profileId !== task.route.providerProfileId ||
      plan.modelRef.modelId !== task.route.modelId ||
      !plan.provider.apiKey?.trim() ||
      CryptoUtils.isEncrypted(plan.provider.apiKey.trim()) ||
      !isTrustedTuziApiBaseUrl(plan.provider.baseUrl) ||
      !isSynchronousImageBinding(resolvedBinding) ||
      !isSameRecoveryBinding(task.route.binding, resolvedBinding)
    ) {
      return null;
    }

    try {
      const preparedSubmission = this.transport.prepareRequest(plan.provider, {
        path: resolvedBinding.submitPath,
        method: resolvedBinding.method,
        baseUrlStrategy: resolvedBinding.baseUrlStrategy,
        requestId: task.requestId,
      });
      const preparedRequestId = Object.entries(preparedSubmission.headers).find(
        ([name]) => name.toLowerCase() === 'x-request-id'
      )?.[1];
      if (preparedRequestId !== task.requestId) {
        return null;
      }
    } catch {
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
    const terminalDelivery = entry.terminalDelivery;
    if (terminalDelivery) {
      entry.terminalDelivery = undefined;
      await terminalDelivery();
      return;
    }
    if (task.deadline <= this.now()) {
      await this.finishFailure(entry, createTimeoutFailure());
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
        await this.finishSuccess(entry, outcome.result);
        return;
      case 'failed':
        await this.finishFailure(entry, outcome.error);
        return;
      case 'processing':
        entry.failureStreak = 0;
        if (!this.scheduleNextPoll(entry)) {
          await this.finishFailure(entry, createTimeoutFailure());
        }
        return;
      case 'transient':
        entry.failureStreak += 1;
        if (!this.scheduleNextPoll(entry)) {
          await this.finishFailure(entry, createTimeoutFailure());
        }
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
    for (const target of queryTargets) {
      if (!this.isCurrent(entry)) {
        return { type: 'transient' };
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
        const response = await waitForFetchResponse(
          this.fetcher(prepared.url, prepared.init),
          controller.signal
        );

        if (!this.isCurrent(entry)) {
          releaseResponseBody(response);
          return { type: 'transient' };
        }
        if (response.status === 401 || response.status === 403) {
          releaseResponseBody(response);
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
          releaseResponseBody(response);
          continue;
        }
        if (!response.ok) {
          releaseResponseBody(response);
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
          await readLimitedJson(response, controller.signal),
          task.requestId
        );
        if (parsed.type === 'processing') {
          return parsed;
        }
        if (parsed.type !== 'transient') {
          return parsed;
        }
      } catch {
        if (!this.isCurrent(entry)) {
          return { type: 'transient' };
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

    return { type: 'transient' };
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

    for (const echoedRequestId of [object.request_id, object.requestId]) {
      if (echoedRequestId === undefined || echoedRequestId === null) {
        continue;
      }
      if (normalizeRequestId(echoedRequestId) !== requestId) {
        return { type: 'processing' };
      }
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

  private scheduleNextPoll(entry: RecoveryEntry): boolean {
    const task = entry.task;
    if (!task || !this.isCurrent(entry)) {
      return true;
    }

    const remainingMs = task.deadline - this.now();
    if (remainingMs <= 0) {
      return false;
    }

    entry.state = 'waiting';
    const delay = Math.min(this.nextDelay(entry.failureStreak), remainingMs);
    entry.pollTimer = setTimeout(() => {
      entry.pollTimer = undefined;
      if (!this.isCurrent(entry)) {
        return;
      }
      entry.state = 'queued';
      this.queue.push(entry);
      this.drainQueue();
    }, delay);
    return true;
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
  ): Promise<void> {
    const callback = entry.callbacks?.onSucceeded;
    return this.deliverTerminalCallback(entry, callback, result, 'success');
  }

  private finishFailure(
    entry: RecoveryEntry,
    error: ImageGenerationRecoveryFailure
  ): Promise<void> {
    const callback = entry.callbacks?.onFailed;
    return this.deliverTerminalCallback(entry, callback, error, 'failure');
  }

  private async deliverTerminalCallback<T>(
    entry: RecoveryEntry,
    callback:
      | ((value: T, signal: AbortSignal) => void | Promise<void>)
      | undefined,
    value: T,
    terminalType: 'success' | 'failure'
  ): Promise<void> {
    if (!callback) {
      this.stopEntry(entry);
      return;
    }

    let callbackController: AbortController | undefined;
    try {
      const task = entry.task;
      if (!task) {
        this.stopEntry(entry);
        return;
      }
      const controller = new AbortController();
      callbackController = controller;
      entry.controller = controller;
      const callbackDeadline = this.now() + this.requestTimeoutMs;
      const callbackPromise = Promise.resolve().then(() =>
        callback(value, controller.signal)
      );
      let outcome = await this.waitForTerminalCallback(
        entry,
        callbackPromise,
        callbackDeadline
      );
      if (outcome === 'completed' && this.isCurrent(entry)) {
        this.stopEntry(entry);
      }
      if (outcome === 'deadline' && this.isCurrent(entry)) {
        const timeoutError = new Error(
          'Image recovery terminal callback timed out'
        );
        timeoutError.name = 'TimeoutError';
        controller.abort(timeoutError);
        outcome = await this.waitForTerminalCallback(
          entry,
          callbackPromise,
          this.now() + TERMINAL_ABORT_GRACE_MS
        );
        if (outcome === 'completed' && this.isCurrent(entry)) {
          this.stopEntry(entry);
          return;
        }
        if (outcome === 'stopped') {
          return;
        }
        console.error(
          `[ImageGenerationRecovery] Recovered ${terminalType} state writeback did not settle before the writeback watchdog`
        );
        this.parkTerminalEntryUntilRecoveryDeadline(entry);
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
      const task = entry.task;
      if (!task) {
        this.stopEntry(entry);
        return;
      }

      const remainingMs = task.deadline - this.now();
      if (remainingMs <= 0) {
        console.error(
          `[ImageGenerationRecovery] Recovered ${terminalType} state could not be persisted before the recovery deadline`
        );
        this.stopEntry(entry);
        return;
      }

      entry.state = 'waiting';
      const retryDelay = Math.min(
        this.nextDelay(entry.terminalDeliveryAttempts),
        remainingMs
      );
      entry.pollTimer = setTimeout(() => {
        entry.pollTimer = undefined;
        if (!this.isCurrent(entry)) {
          return;
        }
        entry.state = 'queued';
        entry.terminalDelivery = () =>
          this.deliverTerminalCallback(entry, callback, value, terminalType);
        this.queue.push(entry);
        this.drainQueue();
      }, retryDelay);
    } finally {
      if (callbackController && entry.controller === callbackController) {
        entry.controller = undefined;
      }
    }
  }

  private waitForTerminalCallback(
    entry: RecoveryEntry,
    callbackPromise: Promise<void>,
    deadline: number
  ): Promise<'completed' | 'deadline' | 'stopped'> {
    return new Promise((resolve, reject) => {
      let activeEntry: RecoveryEntry | null = entry;

      const clearWait = (): boolean => {
        const currentEntry = activeEntry;
        if (!currentEntry) {
          return false;
        }
        activeEntry = null;

        if (currentEntry.terminalTimer) {
          clearTimeout(currentEntry.terminalTimer);
          currentEntry.terminalTimer = undefined;
        }
        currentEntry.releaseTerminalWait = undefined;
        return true;
      };

      const settle = (outcome: 'completed' | 'deadline' | 'stopped') => {
        if (!clearWait()) {
          return;
        }
        resolve(outcome);
      };
      const rejectCallback = (error: unknown) => {
        if (!clearWait()) {
          return;
        }
        reject(error);
      };

      entry.releaseTerminalWait = () => settle('stopped');
      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) {
        settle('deadline');
        return;
      }

      entry.terminalTimer = setTimeout(() => settle('deadline'), remainingMs);
      callbackPromise.then(() => settle('completed'), rejectCallback);
    });
  }

  private parkTerminalEntryUntilRecoveryDeadline(entry: RecoveryEntry): void {
    const task = entry.task;
    if (!task || !this.isCurrent(entry)) {
      return;
    }

    const remainingMs = task.deadline - this.now();
    if (remainingMs <= 0) {
      this.stopEntry(entry);
      return;
    }

    // 写回 Promise 永久悬挂时不能并行创建更多 IndexedDB 写入。保留一个不含
    // 结果数据的轻量占位直到恢复截止时间，周期扫描只会复用它，不会重复查询或写入。
    entry.callbacks = null;
    entry.state = 'waiting';
    entry.pollTimer = setTimeout(() => {
      entry.pollTimer = undefined;
      if (this.isCurrent(entry)) {
        this.stopEntry(entry);
      }
    }, remainingMs);
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
    entry.releaseTerminalWait?.();
    entry.releaseTerminalWait = undefined;
    if (entry.terminalTimer) {
      clearTimeout(entry.terminalTimer);
      entry.terminalTimer = undefined;
    }
    entry.controller?.abort();
    entry.controller = undefined;
    entry.terminalDelivery = undefined;
    entry.task = null;
    entry.callbacks = null;

    if (removeFromQueue) {
      this.queue = this.queue.filter((queuedEntry) => queuedEntry !== entry);
    }
  }
}

export const imageGenerationRecoveryService =
  new ImageGenerationRecoveryService();

export function isImageRequestRecoveryCandidate(task: Task): boolean {
  const route = task.invocationRoute;
  const binding = createRecoveryBindingFingerprint(route?.binding);
  return (
    task.type === TaskType.IMAGE &&
    task.status === TaskStatus.PROCESSING &&
    Boolean(normalizeRequestId(task.id)) &&
    Boolean(
      normalizeRequestId(task.params[IMAGE_SUBMISSION_REQUEST_ID_PARAM])
    ) &&
    hasImageSubmissionAttempt(task) &&
    route?.operation === 'image' &&
    Boolean(normalizeRequiredString(route.providerProfileId)) &&
    Boolean(
      normalizeRequiredString(route.modelRef?.modelId || route.modelId)
    ) &&
    Boolean(binding && isSynchronousImageBinding(binding)) &&
    task.executionPhase === TaskExecutionPhase.POLLING &&
    !task.remoteId &&
    !task.syncedFromRemote
  );
}

export function isCurrentImageRecoveryAttempt(
  task: Task | undefined,
  requestId: string,
  startedAt: number
): task is Task {
  const expectedRequestId = normalizeRequestId(requestId);
  return Boolean(
    task &&
      task.type === TaskType.IMAGE &&
      task.status === TaskStatus.PROCESSING &&
      expectedRequestId &&
      normalizeRequestId(getImageSubmissionRequestId(task)) ===
        expectedRequestId &&
      hasImageSubmissionAttempt(task) &&
      task.executionPhase === TaskExecutionPhase.POLLING &&
      (task.startedAt ?? task.createdAt) === startedAt &&
      !task.remoteId &&
      !task.syncedFromRemote
  );
}
