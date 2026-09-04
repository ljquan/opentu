import type { ProviderProfile } from '../utils/settings-manager';

const API_PATH = '/api/image-inspection';
const REQUEST_TIMEOUT_MS = 45_000;
const EXPORT_TIMEOUT_MS = 5 * 60_000;

export type ServerImageInspectionRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'stopped';

export type ServerImageInspectionCaseStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'warning'
  | 'failed'
  | 'stopped';

export interface ServerImageInspectionRun {
  id: number;
  user_id: number;
  token_id: number;
  schedule_key: string;
  trigger_type: 'manual' | 'daily' | string;
  prompt: string;
  status: ServerImageInspectionRunStatus;
  total_cases: number;
  passed_cases: number;
  warning_cases: number;
  failed_cases: number;
  stopped_cases: number;
  started_at: number;
  finished_at: number;
  created_at: number;
  updated_at: number;
}

export interface ServerImageInspectionCase {
  id: number;
  run_id: number;
  case_key: string;
  group: string;
  model: string;
  aspect_ratio: string;
  requested_resolution: string;
  requested_size: string;
  expected_width: number;
  expected_height: number;
  status: ServerImageInspectionCaseStatus;
  task_id: string;
  request_id: string;
  image_url: string;
  actual_width: number;
  actual_height: number;
  duration_ms: number;
  formula: string;
  message: string;
  error: string;
  attempts: number;
  started_at: number;
  finished_at: number;
  created_at: number;
  updated_at: number;
}

export interface ServerImageInspectionModelScope {
  models: string[];
  groups: Record<string, string[]>;
}

export interface ServerImageInspectionRunPage {
  run: ServerImageInspectionRun;
  cases: ServerImageInspectionCase[];
  caseTotal: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface ImageInspectionApiClient {
  getModels(signal?: AbortSignal): Promise<ServerImageInspectionModelScope>;
  createRun(
    prompt: string,
    signal?: AbortSignal
  ): Promise<ServerImageInspectionRun>;
  listRuns(signal?: AbortSignal): Promise<ServerImageInspectionRun[]>;
  getRun(
    runId: number,
    caseLimit: number,
    caseOffset: number,
    signal?: AbortSignal
  ): Promise<ServerImageInspectionRunPage>;
  stopRun(runId: number, signal?: AbortSignal): Promise<void>;
  exportRun(runId: number, signal?: AbortSignal): Promise<Blob>;
}

const TUZI_API_HOSTS = new Set([
  'api.tu-zi.com',
  'apius.tu-zi.com',
  'apicdn.tu-zi.com',
  'api.sydney-ai.com',
  'api.ourzhishi.top',
  'apisz.ourzhishi.top',
]);

export function isTuziProviderProfile(profile: ProviderProfile): boolean {
  try {
    const url = new URL(
      /^[a-z][a-z\d+\-.]*:\/\//i.test(profile.baseUrl)
        ? profile.baseUrl
        : `https://${profile.baseUrl}`
    );
    return TUZI_API_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function selectImageInspectionProfile(
  profiles: ProviderProfile[]
): ProviderProfile | null {
  return (
    profiles.find(
      (profile) =>
        profile.enabled &&
        profile.apiKey.trim() &&
        isTuziProviderProfile(profile)
    ) || null
  );
}

function normalizeApiOrigin(baseUrl: string): string {
  const normalized = /^[a-z][a-z\d+\-.]*:\/\//i.test(baseUrl.trim())
    ? baseUrl.trim()
    : `https://${baseUrl.trim()}`;
  return new URL(normalized).origin;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // 非 JSON 错误统一在下方转为可读消息。
  }
  if (!response.ok || !payload?.success || payload.data === undefined) {
    throw new Error(
      payload?.message || `巡检服务请求失败（HTTP ${response.status}）`
    );
  }
  return payload.data;
}

export async function fetchImageInspectionWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !externalSignal?.aborted) {
      throw new Error(`巡检服务请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export function createImageInspectionApiClient(
  profile: ProviderProfile
): ImageInspectionApiClient {
  const baseUrl = `${normalizeApiOrigin(profile.baseUrl)}${API_PATH}`;
  const headers = () => ({
    Authorization: `Bearer ${profile.apiKey.trim()}`,
  });
  const request = async <T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> => {
    const response = await fetchImageInspectionWithTimeout(
      `${baseUrl}${path}`,
      {
        ...init,
        cache: 'no-store',
        headers: {
          ...headers(),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      },
      REQUEST_TIMEOUT_MS
    );
    return parseEnvelope<T>(response);
  };

  return {
    getModels: (signal) => request('/models', { signal }),
    createRun: (prompt, signal) =>
      request('/runs', {
        method: 'POST',
        signal,
        body: JSON.stringify({ trigger_type: 'manual', prompt }),
      }),
    listRuns: (signal) => request('/runs?limit=20&offset=0', { signal }),
    getRun: async (runId, caseLimit, caseOffset, signal) => {
      const data = await request<{
        run: ServerImageInspectionRun;
        cases: ServerImageInspectionCase[];
        case_total: number;
      }>(
        `/runs/${runId}?case_limit=${caseLimit}&case_offset=${caseOffset}&results_only=true`,
        { signal }
      );
      return {
        run: data.run,
        cases: data.cases || [],
        caseTotal: data.case_total || 0,
      };
    },
    stopRun: async (runId, signal) => {
      const response = await fetchImageInspectionWithTimeout(
        `${baseUrl}/runs/${runId}/stop`,
        {
          method: 'POST',
          cache: 'no-store',
          signal,
          headers: headers(),
        },
        REQUEST_TIMEOUT_MS
      );
      const payload = (await response
        .json()
        .catch(() => null)) as ApiEnvelope<unknown> | null;
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message || `停止巡检失败（HTTP ${response.status}）`
        );
      }
    },
    exportRun: async (runId, signal) => {
      const response = await fetchImageInspectionWithTimeout(
        `${baseUrl}/runs/${runId}/export`,
        {
          cache: 'no-store',
          signal,
          headers: headers(),
        },
        EXPORT_TIMEOUT_MS
      );
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ApiEnvelope<unknown> | null;
        throw new Error(
          payload?.message || `导出巡检失败（HTTP ${response.status}）`
        );
      }
      return response.blob();
    },
  };
}

export function isImageInspectionRunActive(
  status: ServerImageInspectionRunStatus
): boolean {
  return status === 'pending' || status === 'running';
}
