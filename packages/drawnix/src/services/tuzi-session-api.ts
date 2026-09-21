import type { TuziEmbeddedConfig } from './tuzi-embedded-config';
import { tuziEmbeddedConfig } from './tuzi-embedded-config';
import {
  ensureTuziProviders,
  getTuziBridgeContext,
  isTuziBridgeConnected,
} from './tuzi-postmessage-bridge';
import { getTuziSystemToken, getTuziSystemUserId } from './tuzi-token-auth';
import { extractTuziGeneratedImageUrls } from './tuzi-log-media';

export type TuziSessionErrorCode =
  | 'TOKEN_INVALID'
  | 'ACCOUNT_DISABLED'
  | 'REQUEST_FAILED'
  | 'INVALID_RESPONSE'
  | 'NOT_CONFIGURED';

export class TuziSessionApiError extends Error {
  constructor(
    public readonly code: TuziSessionErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'TuziSessionApiError';
  }
}

export interface TuziAccount {
  id: number;
  role: number;
  username: string;
  displayName: string;
  email: string;
  group: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
}

export interface TuziUsageLog {
  id: number;
  createdAt: number;
  type: number;
  channelId: string;
  channelName: string;
  username: string;
  userId: string;
  tokenName: string;
  content: string;
  modelName: string;
  callStatus: string;
  quota: number;
  promptTokens: number;
  completionTokens: number;
  useTime: number;
  ip: string;
  retryCount: number;
  requestId: string;
  responseId: string;
  upstreamRequestId: string;
  generatedImageUrls?: string[];
  other: Record<string, unknown>;
}

export interface TuziLogPage {
  items: TuziUsageLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TuziUsageSummary {
  quota: number;
  rpm: number;
  tpm: number;
}

export interface TuziManagedProvider {
  id: string;
  group: string;
  displayName: string;
  apiKey: string;
  status: number;
  rotatedAt: number;
}

export interface TuziProviderGroup {
  group: string;
  displayName: string;
}

export type TuziQuotaDisplayType = 'USD' | 'CNY' | 'CUSTOM' | 'TOKENS';

export interface TuziDisplayConfig {
  quotaPerUnit: number;
  quotaDisplayType: TuziQuotaDisplayType;
  usdExchangeRate: number;
  customCurrencySymbol: string;
  customCurrencyExchangeRate: number;
}

type JsonRecord = Record<string, unknown>;
const TUZI_REQUEST_TIMEOUT_MS = 15_000;
const TUZI_PROVIDER_GROUPS_REQUEST_TIMEOUT_MS = 6_000;
const TUZI_PROVIDER_GROUPS_RETRY_DELAY_MS = 250;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function logOtherValue(value: unknown): JsonRecord {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value)) || {};
    } catch {
      return {};
    }
  }
  return asRecord(value) || {};
}

function responseMessage(payload: JsonRecord | null, fallback: string): string {
  const error = asRecord(payload?.error);
  return (
    stringValue(error?.message) || stringValue(payload?.message) || fallback
  );
}

function responseCode(payload: JsonRecord | null): string {
  return stringValue(asRecord(payload?.error)?.code);
}

export class TuziSessionApiClient {
  private readonly baseUrl: string;

  constructor(
    config: TuziEmbeddedConfig = tuziEmbeddedConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly systemToken: string = getTuziSystemToken(),
    private readonly systemUserId: string = getTuziSystemUserId()
  ) {
    if (!config.enabled || !config.apiBaseUrl) {
      throw new TuziSessionApiError('NOT_CONFIGURED', 'Tuzi API 地址未配置');
    }
    this.baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  }

  private async request(
    path: string,
    query?: URLSearchParams,
    method: 'GET' | 'POST' = 'GET',
    body?: string,
    timeoutMs = TUZI_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    if (!this.systemToken) {
      throw new TuziSessionApiError('NOT_CONFIGURED', '请先填写系统访问令牌');
    }
    const useSameOriginSessionProxy =
      typeof window !== 'undefined' &&
      new URL(this.baseUrl).origin !== window.location.origin;
    const url = useSameOriginSessionProxy
      ? new URL(`/__opentu_tuzi_session__${path}`, window.location.origin)
      : new URL(path, `${this.baseUrl}/`);
    if (
      !useSameOriginSessionProxy &&
      url.origin !== new URL(this.baseUrl).origin
    ) {
      throw new TuziSessionApiError('REQUEST_FAILED', '请求地址不受信任');
    }
    if (query) url.search = query.toString();

    let response: Response;
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    try {
      response = await this.fetcher.call(globalThis, url.toString(), {
        method,
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${this.systemToken}`,
          'New-Api-User': this.systemUserId,
        },
        ...(body ? { body } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (controller?.signal.aborted) {
        throw new TuziSessionApiError(
          'REQUEST_FAILED',
          'Tuzi API 请求超时，请稍后重试'
        );
      }
      throw new TuziSessionApiError(
        'REQUEST_FAILED',
        error instanceof Error ? error.message : '无法连接 Tuzi API'
      );
    }
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (response.ok) {
        throw new TuziSessionApiError(
          'INVALID_RESPONSE',
          'Tuzi API 返回了无效响应',
          response.status
        );
      }
    }
    if (timeoutId !== undefined) clearTimeout(timeoutId);

    const object = asRecord(payload);
    const code = responseCode(object);
    if (response.status === 401 || code === 'TOKEN_INVALID') {
      throw new TuziSessionApiError(
        'TOKEN_INVALID',
        responseMessage(object, '系统访问令牌无效或已过期'),
        response.status
      );
    }
    if (response.status === 403 || code === 'ACCOUNT_DISABLED') {
      throw new TuziSessionApiError(
        'ACCOUNT_DISABLED',
        responseMessage(object, '账户不可用'),
        response.status
      );
    }
    if (!response.ok || object?.success === false) {
      throw new TuziSessionApiError(
        'REQUEST_FAILED',
        responseMessage(object, `请求失败 (${response.status})`),
        response.status
      );
    }
    return object?.data;
  }

  async ensureManagedProviders(
    groups?: readonly string[]
  ): Promise<TuziManagedProvider[]> {
    const selectedGroups = groups
      ? new Set(groups.map((group) => group.trim()).filter(Boolean))
      : null;
    const body = selectedGroups
      ? JSON.stringify({ groups: [...selectedGroups] })
      : undefined;
    if (isTuziBridgeConnected()) {
      return ensureTuziProviders(selectedGroups ? [...selectedGroups] : []);
    }
    let data: JsonRecord | null;
    try {
      data = asRecord(
        await this.request(
          '/api/opentu/providers/ensure',
          undefined,
          'POST',
          body
        )
      );
    } catch (error) {
      // Older Tuzi deployments do not expose managed-provider routes. Keep
      // account/balance data usable when this optional synchronization API is
      // unavailable.
      if (error instanceof TuziSessionApiError && error.status === 404) {
        return [];
      }
      throw error;
    }
    if (!Array.isArray(data?.providers)) return [];
    return data.providers.flatMap((item) => {
      const provider = asRecord(item);
      if (
        typeof provider?.id !== 'string' ||
        typeof provider.group !== 'string' ||
        typeof provider.api_key !== 'string'
      ) {
        return [];
      }
      const managedProvider = {
        id: provider.id,
        group: provider.group.trim(),
        displayName: stringValue(provider.display_name),
        apiKey: provider.api_key,
        status: numberValue(provider.status),
        rotatedAt: numberValue(provider.rotated_at),
      };
      if (
        !managedProvider.group ||
        (selectedGroups && !selectedGroups.has(managedProvider.group))
      ) {
        return [];
      }
      return [managedProvider];
    });
  }

  async getProviderGroups(): Promise<TuziProviderGroup[]> {
    if (isTuziBridgeConnected()) {
      return (getTuziBridgeContext()?.groups || []).map((group) => ({
        group: group.group,
        displayName: group.displayName,
      }));
    }
    let data: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        data = await this.request(
          '/api/opentu/provider-groups',
          undefined,
          'GET',
          undefined,
          TUZI_PROVIDER_GROUPS_REQUEST_TIMEOUT_MS
        );
        break;
      } catch (error) {
        if (error instanceof TuziSessionApiError && error.status === 404) {
          return [];
        }
        const retryable =
          error instanceof TuziSessionApiError &&
          error.code === 'REQUEST_FAILED' &&
          (error.status === undefined ||
            error.status === 408 ||
            error.status === 429 ||
            error.status >= 500);
        if (!retryable || attempt === 1) {
          throw error;
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, TUZI_PROVIDER_GROUPS_RETRY_DELAY_MS)
        );
      }
    }
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      const group = asRecord(item);
      if (!group) return [];
      const groupId = stringValue(group.group).trim();
      if (!groupId) return [];
      return [
        {
          group: groupId,
          displayName: stringValue(group.display_name).trim() || groupId,
        },
      ];
    });
  }

  async rotateManagedProvider(group: string): Promise<TuziManagedProvider> {
    const query = new URLSearchParams({
      previous_token_action: 'delete',
    });
    const data = asRecord(
      await this.request(
        `/api/opentu/providers/${encodeURIComponent(group)}/rotate`,
        query,
        'POST'
      )
    );
    const provider = asRecord(data);
    if (
      !provider ||
      typeof provider.id !== 'string' ||
      typeof provider.api_key !== 'string'
    ) {
      throw new TuziSessionApiError(
        'INVALID_RESPONSE',
        '托管供应商响应格式无效'
      );
    }
    if (provider.previous_token_deleted === false) {
      throw new TuziSessionApiError(
        'REQUEST_FAILED',
        '新 Key 已生成，但旧 Key 删除失败，请重试'
      );
    }
    return {
      id: provider.id,
      group: stringValue(provider.group),
      displayName: stringValue(provider.display_name),
      apiKey: provider.api_key,
      status: numberValue(provider.status),
      rotatedAt: numberValue(provider.rotated_at),
    };
  }

  async getAccount(): Promise<TuziAccount> {
    const data = asRecord(await this.request('/api/user/self'));
    if (!data) {
      throw new TuziSessionApiError('INVALID_RESPONSE', '账户数据格式无效');
    }
    return {
      id: numberValue(data.id),
      role: numberValue(data.role),
      username: stringValue(data.username),
      displayName: stringValue(data.display_name),
      email: stringValue(data.email),
      group: stringValue(data.group),
      quota: numberValue(data.quota),
      usedQuota: numberValue(data.used_quota),
      requestCount: numberValue(data.request_count),
    };
  }

  async getDisplayConfig(): Promise<TuziDisplayConfig> {
    const data = asRecord(await this.request('/api/status')) || {};
    const displayType = stringValue(data.quota_display_type).toUpperCase();
    return {
      quotaPerUnit: numberValue(data.quota_per_unit) || 1,
      quotaDisplayType: ['USD', 'CNY', 'CUSTOM', 'TOKENS'].includes(displayType)
        ? (displayType as TuziQuotaDisplayType)
        : data.display_in_currency === true
        ? 'CNY'
        : 'USD',
      usdExchangeRate: numberValue(data.usd_exchange_rate) || 1,
      customCurrencySymbol: stringValue(data.custom_currency_symbol) || '¤',
      customCurrencyExchangeRate:
        numberValue(data.custom_currency_exchange_rate) || 1,
    };
  }

  async getModels(): Promise<string[]> {
    const data = await this.request('/api/user/models');
    return Array.isArray(data)
      ? [
          ...new Set(
            data.filter((item): item is string => typeof item === 'string')
          ),
        ]
      : [];
  }

  async getLogs(
    page = 1,
    pageSize = 20,
    _canViewAllLogs = false
  ): Promise<TuziLogPage> {
    const query = new URLSearchParams({
      p: String(Math.max(1, page)),
      page_size: String(Math.max(1, pageSize)),
      type: '2',
    });
    const data = asRecord(await this.request('/api/log/self', query));
    const rawItems = Array.isArray(data?.items) ? data.items : [];
    return {
      items: rawItems.map((item) => {
        const log = asRecord(item) || {};
        const other = logOtherValue(log.other);
        return {
          id: numberValue(log.id),
          createdAt: numberValue(log.created_at),
          type: numberValue(log.type),
          channelId:
            idValue(log.channel) ||
            idValue(log.channel_id) ||
            idValue(log.channelId),
          channelName:
            stringValue(log.channel_name) || stringValue(log.channelName),
          username:
            stringValue(log.username) ||
            stringValue(log.user_name) ||
            stringValue(log.user),
          userId: idValue(log.user_id) || idValue(log.userId),
          tokenName:
            stringValue(log.token_name) ||
            stringValue(log.tokenName) ||
            stringValue(log.token),
          content: stringValue(log.content),
          modelName: stringValue(log.model_name),
          callStatus:
            stringValue(log.status_text) ||
            stringValue(log.call_status) ||
            idValue(log.status),
          quota: numberValue(log.quota),
          promptTokens: numberValue(log.prompt_tokens),
          completionTokens: numberValue(log.completion_tokens),
          useTime: numberValue(log.use_time),
          ip: stringValue(log.ip),
          retryCount:
            numberValue(log.retry_count) ||
            numberValue(log.retryCount) ||
            numberValue(log.retry),
          requestId: stringValue(log.request_id),
          responseId: stringValue(log.response_id),
          upstreamRequestId:
            stringValue(log.upstream_request_id) ||
            stringValue(log.upstreamRequestId),
          generatedImageUrls: extractTuziGeneratedImageUrls(
            other,
            this.baseUrl
          ),
          other,
        };
      }),
      total: numberValue(data?.total),
      page: numberValue(data?.page) || page,
      pageSize: numberValue(data?.page_size) || pageSize,
    };
  }

  async getUsageSummary(): Promise<TuziUsageSummary> {
    const endTimestamp = Math.floor(Date.now() / 1000);
    const startTimestamp = endTimestamp - 30 * 24 * 60 * 60;
    const query = new URLSearchParams({
      start_timestamp: String(startTimestamp),
      end_timestamp: String(endTimestamp),
      type: '2',
    });
    const data =
      asRecord(await this.request('/api/log/self/stat', query)) || {};
    return {
      quota: numberValue(data.quota),
      rpm: numberValue(data.rpm),
      tpm: numberValue(data.tpm),
    };
  }
}
