import type { ModelRef } from '../utils/settings-manager';
import { resolveInvocationPlanFromRoute } from './provider-routing';
import type {
  ProviderBaseUrlStrategy,
  ResolvedProviderContext,
} from './provider-routing';
import { canAttachProviderRequestIdHeader } from './provider-routing';
import { providerTransport } from './provider-routing';

const RECOVERY_ATTEMPTS = 5;
const RECOVERY_DELAY_MS = 1500;

export interface RecoveredAsyncSubmission {
  remoteId?: string;
  status?: string;
  url?: string;
  raw: Record<string, unknown>;
}

export function generateClientRequestId(): string {
  const runtime = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof runtime.crypto?.randomUUID === 'function') {
    return runtime.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function canRecoverSubmissionByRequestId(
  provider: ResolvedProviderContext,
  path: string,
  baseUrlStrategy?: ProviderBaseUrlStrategy
): boolean {
  return canAttachProviderRequestIdHeader(provider, {
    path,
    baseUrlStrategy,
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') {
    return asRecord(value);
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function collectPayloads(data: Record<string, unknown>): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const key of ['data', 'result', 'response', 'body']) {
    const nested = parseJsonRecord(data[key]);
    if (nested) {
      payloads.push(nested);
    }
  }
  payloads.push(data);
  return payloads;
}

function firstString(
  payloads: Record<string, unknown>[],
  keys: string[]
): string | undefined {
  for (const payload of payloads) {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function extractRecoveredSubmission(
  data: Record<string, unknown>
): RecoveredAsyncSubmission {
  const payloads = collectPayloads(data);
  const firstArrayItem = Array.isArray(data.data)
    ? asRecord(data.data[0])
    : undefined;
  if (firstArrayItem) {
    payloads.push(firstArrayItem);
  }

  return {
    remoteId: firstString(payloads, [
      'id',
      'taskId',
      'task_id',
      'videoId',
      'video_id',
    ]),
    status: firstString(payloads, ['status', 'state']),
    url: firstString(payloads, [
      'video_url',
      'audio_url',
      'image_url',
      'url',
    ]),
    raw: data,
  };
}

function isPendingRecoveryStatus(status?: string): boolean {
  const normalized = status?.toLowerCase();
  return (
    !normalized ||
    normalized === 'processing' ||
    normalized === 'processing_or_not_found' ||
    normalized === 'queued' ||
    normalized === 'in_progress' ||
    normalized === 'pending'
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

export async function recoverAsyncSubmissionByRequestId(
  operation: 'image' | 'video' | 'audio',
  routeModel: string | ModelRef | null,
  requestId: string,
  options: { bindingId?: string | null; signal?: AbortSignal } = {}
): Promise<RecoveredAsyncSubmission> {
  const plan = resolveInvocationPlanFromRoute(operation, routeModel, {
    bindingId: options.bindingId,
  });
  if (!plan) {
    throw new Error('原供应商路由已不可用，无法找回提交记录');
  }

  let last: RecoveredAsyncSubmission | undefined;
  for (let attempt = 1; attempt <= RECOVERY_ATTEMPTS; attempt += 1) {
    const response = await providerTransport.send(plan.provider, {
      path: '/log/get-request',
      method: 'GET',
      query: { id: requestId },
      baseUrlStrategy: 'trim-v1',
      signal: options.signal,
      timeoutMs: 15_000,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `提交记录找回失败: ${response.status} - ${body.slice(0, 200)}`
      );
    }

    last = extractRecoveredSubmission(
      (await response.json()) as Record<string, unknown>
    );
    if (last.remoteId || last.url || !isPendingRecoveryStatus(last.status)) {
      return last;
    }
    if (attempt < RECOVERY_ATTEMPTS) {
      await delay(RECOVERY_DELAY_MS, options.signal);
    }
  }

  return last || { raw: {} };
}
