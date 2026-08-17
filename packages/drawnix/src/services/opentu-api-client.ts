import {
  OpenTuCredentialSession,
  OpenTuCredentialVault,
  calculateJwkThumbprint,
  createDpopProof,
  normalizeP256PublicJwk,
  type P256PublicJwk,
  type OpenTuRefreshResult,
  type StoredOpenTuCredential,
} from './opentu-credential';

const LOCAL_TUZI_DPOP_ORIGIN = 'http://127.0.0.1:5173';
const PRODUCTION_TUZI_DPOP_ORIGIN = 'https://api.tu-zi.com';
const OPENTU_AUTH_PATH = '/api/opentu';
const OPENTU_RELAY_PATH = '/opentu/v1';
const NONCE_LIFETIME_MS = 5 * 60 * 1000;

export interface OpenTuAccount {
  id: number;
  username: string;
  display_name: string;
  displayName?: string;
  email: string;
  /** Server-owned quota value. The client does not apply a currency conversion. */
  quota: number | string;
  used_quota?: number | string;
  request_count?: number;
  group: string;
  credential_id: string;
  credentialId?: string;
  [key: string]: unknown;
}

export interface OpenTuPricingModel {
  model_name: string;
  description?: string;
  tags?: string;
  quota_type?: number;
  model_ratio?: number;
  completion_ratio?: number;
  model_price?: number;
  enable_groups?: string[];
  supported_endpoint_types?: Array<string | number>;
  [key: string]: unknown;
}

export interface OpenTuPricing {
  models: OpenTuPricingModel[];
  vendors?: unknown;
  group_ratio?: Record<string, number>;
  base_group_ratio?: Record<string, number>;
  group_discount_ratio?: Record<string, number>;
  usable_group?: Record<string, string>;
  group_info?: Record<string, unknown>;
  group_model_pricing?: Record<string, unknown>;
  supported_endpoint?: Record<string, unknown>;
  auto_groups?: unknown;
  all_level_discounts?: unknown;
  all_level_groups?: unknown;
  all_level_group_info?: unknown;
  level_names?: unknown;
  user_level?: unknown;
  pricing_version?: string | number;
  [key: string]: unknown;
}

export interface OpenTuUsageRecord {
  id: number | string;
  created_at: number | string;
  model_name?: string;
  output?: number;
  detail?: string;
  amount?: number | string;
  currency?: string;
  currency_symbol?: string;
  request_id?: string;
  [key: string]: unknown;
}

export interface OpenTuUsagePage {
  page: number;
  page_size: number;
  total: number;
  items: OpenTuUsageRecord[];
  [key: string]: unknown;
}

export interface OpenTuUsageQuery {
  page?: number;
  pageSize?: number;
  type?: string | number;
  modelName?: string;
  startTime?: number;
  endTime?: number;
}

export interface OpenTuUsageSummary {
  quota: number | string;
  rpm: number;
  tpm: number;
  [key: string]: unknown;
}

export interface OpenTuTopupRecord {
  id: number | string;
  amount?: number | string;
  money?: number | string;
  fee?: number | string;
  order_currency?: string;
  trade_no?: string;
  payment_method?: string;
  payment_provider?: string;
  create_time?: number | string;
  complete_time?: number | string;
  status?: string;
  invoice_eligible?: boolean;
  invoiced?: boolean;
  invoice_amount?: number | string;
  invoice_currency?: string;
  invoice_status?: string;
  [key: string]: unknown;
}

export interface OpenTuTopupsPage {
  page: number;
  page_size: number;
  total: number;
  items: OpenTuTopupRecord[];
  [key: string]: unknown;
}

export interface OpenTuTopupQuery {
  page?: number;
  pageSize?: number;
}

export interface OpenTuTopupGateway {
  id: number | string;
  uuid?: string;
  type: string;
  name: string;
  icon?: string;
  currency?: string;
  min_amount?: number | string;
  max_amount?: number | string;
  fixed_fee?: number | string;
  percent_fee?: number | string;
  currency_discount?: number | string;
  [key: string]: unknown;
}

export interface OpenTuTopupInfo {
  enable_online_topup?: boolean;
  payment_compliance_confirmed?: boolean;
  payment_compliance_terms_version?: string;
  min_topup?: number | string;
  amount_options?: Array<number | string>;
  discount?: Record<string, number>;
  gateways?: OpenTuTopupGateway[];
  topup_link?: string;
  [key: string]: unknown;
}

export interface OpenTuTopupOrderInput {
  gateway_id: number;
  amount: number;
}

export interface OpenTuTopupQuote {
  amount: number | string;
  base_amount: number | string;
  fee: number | string;
  total_amount: number | string;
  currency: string;
  fixed_fee: number | string;
  percent_fee: number | string;
  discount: number | string;
  topup_group_ratio: number | string;
  [key: string]: unknown;
}

export interface OpenTuTopupCreateResult {
  trade_no: string;
  payment_url?: string;
  completed?: boolean;
  qrcode_url?: string;
  qrcode_content?: string;
  display_mode?: string;
  [key: string]: unknown;
}

export interface OpenTuTopupQueryInput {
  trade_no: string;
}

export interface OpenTuTopupQueryResult {
  status: string;
  message: string;
  gateway_status?: string;
  [key: string]: unknown;
}

export interface OpenTuDevice {
  id: number | string;
  credential_id: string;
  name: string;
  status: string;
  last_seen_at?: number | string | null;
  revoked_at?: number | string | null;
  created_at?: number | string;
  updated_at?: number | string;
  [key: string]: unknown;
}

export interface OpenTuDeviceRevokeResult {
  id: number | string;
  status: string;
  [key: string]: unknown;
}

export interface OpenTuManagedProviderGroup {
  group: string;
  display_name: string;
  api_key: string;
  base_url: string;
  status?: string;
  token_id?: number | string;
}

export interface OpenTuApiClientOptions {
  origin?: string;
  vault?: OpenTuCredentialVault;
  session?: OpenTuCredentialSession;
  fetcher?: typeof fetch;
  now?: () => number;
}

export interface OpenTuProtectedRequestInit extends RequestInit {
  fetcher?: typeof fetch;
}

export interface OpenTuDeviceBindingInput {
  grantId: string;
  deviceCode: string;
  publicJwk: P256PublicJwk;
  privateKey: CryptoKey;
}

export class OpenTuApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode = '',
    readonly errorDescription = ''
  ) {
    super(`${message} (${status})`);
    this.name = 'OpenTuApiResponseError';
  }
}

interface OpenTuApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
  [key: string]: unknown;
}

interface OpenTuTokenResponse {
  token_type: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
  credential_id?: string;
  device_id?: string;
}

function configuredOrigin(): string {
  const value = import.meta.env.VITE_TUZI_DPOP_ORIGIN?.trim();
  if (value) return value;
  return import.meta.env.DEV
    ? LOCAL_TUZI_DPOP_ORIGIN
    : PRODUCTION_TUZI_DPOP_ORIGIN;
}

/** Accept only an HTTP(S) origin, never an origin plus a path or credentials. */
export function normalizeTuziDpopOrigin(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('VITE_TUZI_DPOP_ORIGIN must be an absolute HTTP(S) origin');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'VITE_TUZI_DPOP_ORIGIN must contain only an HTTP(S) origin'
    );
  }
  return parsed.origin;
}

function withoutClientAuthHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.delete('Authorization');
  result.delete('DPoP');
  result.delete('Cookie');
  return result;
}

function jsonHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set('Content-Type', 'application/json');
  return result;
}

async function readProtocolError(response: Response): Promise<string> {
  try {
    const payload = (await response.clone().json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : '';
  } catch {
    return '';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isManagedProviderGroup(
  value: unknown
): value is OpenTuManagedProviderGroup {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.group === 'string' &&
    Boolean(value.group.trim()) &&
    typeof value.display_name === 'string' &&
    Boolean(value.display_name.trim()) &&
    typeof value.api_key === 'string' &&
    Boolean(value.api_key.trim()) &&
    typeof value.base_url === 'string' &&
    Boolean(value.base_url.trim()) &&
    (value.status === undefined || typeof value.status === 'string') &&
    (value.token_id === undefined ||
      typeof value.token_id === 'string' ||
      typeof value.token_id === 'number')
  );
}

function isApiEnvelope(value: unknown): value is OpenTuApiEnvelope<unknown> {
  return isPlainRecord(value) && typeof value.success === 'boolean';
}

function buildQuery(
  values: Record<string, string | number | undefined>
): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function isInvalidAccessToken(response: Response): Promise<boolean> {
  return (
    response.status === 401 &&
    (await readProtocolError(response)) === 'invalid_token'
  );
}

function parseTokenResponse(
  payload: OpenTuTokenResponse,
  now: number
): OpenTuRefreshResult {
  if (
    payload.token_type.toLowerCase() !== 'dpop' ||
    !payload.access_token ||
    !payload.refresh_token ||
    !Number.isFinite(payload.expires_in) ||
    payload.expires_in <= 0
  ) {
    throw new Error('Tuzi returned an invalid OpenTu token response');
  }
  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: now + payload.expires_in * 1000,
    refreshToken: payload.refresh_token,
    credentialId: payload.credential_id,
    deviceId: payload.device_id,
  };
}

function providerPathname(path: string): string | null {
  const withoutQuery = path.split(/[?#]/, 1)[0] || '';
  const normalized = withoutQuery.startsWith('/')
    ? withoutQuery
    : `/${withoutQuery}`;
  if (normalized === '/v1') return '/';
  if (normalized.startsWith('/v1/')) return normalized.slice(3);
  return normalized;
}

function hasUnsafePathSegment(pathname: string): boolean {
  try {
    return decodeURIComponent(pathname)
      .split('/')
      .some((segment) => segment === '..' || segment === '.');
  } catch {
    return true;
  }
}

/** Mirrors the server relay allowlist so DPoP cannot become an arbitrary proxy. */
export function isAllowedOpenTuRelayPath(
  path: string,
  method = 'GET'
): boolean {
  const pathname = providerPathname(path);
  if (!pathname || hasUnsafePathSegment(pathname)) {
    return false;
  }
  const verb = method.toUpperCase();
  if (verb === 'GET') {
    return pathname === '/models' || /^\/videos\/[^/]+$/.test(pathname);
  }
  if (verb !== 'POST') return false;
  return (
    [
      '/chat/completions',
      '/responses',
      '/embeddings',
      '/audio/speech',
      '/audio/transcriptions',
      '/images/generations',
      '/images/edits',
      '/videos',
    ].includes(pathname) || /^\/videos\/[^/]+\/remix$/.test(pathname)
  );
}

export function toOpenTuRelayPath(path: string, method = 'GET'): string {
  if (!isAllowedOpenTuRelayPath(path, method)) {
    throw new Error(
      `Unsupported OpenTu relay route: ${method.toUpperCase()} ${path}`
    );
  }
  const queryIndex = path.search(/[?#]/);
  const suffix = queryIndex >= 0 ? path.slice(queryIndex).split('#', 1)[0] : '';
  return `${OPENTU_RELAY_PATH}${providerPathname(path)}${suffix}`;
}

export class OpenTuApiClient {
  readonly origin: string;
  private readonly vault: OpenTuCredentialVault;
  private readonly session: OpenTuCredentialSession;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(options: OpenTuApiClientOptions = {}) {
    this.origin = normalizeTuziDpopOrigin(options.origin || configuredOrigin());
    this.vault = options.vault || new OpenTuCredentialVault();
    this.session = options.session || new OpenTuCredentialSession(this.vault);
    this.fetcher = options.fetcher || fetch;
    this.now = options.now || Date.now;
  }

  async hasCredential(): Promise<boolean> {
    return Boolean(await this.vault.load());
  }

  setAccessToken(token: string, expiresAt: number): void {
    this.session.setAccessToken(token, expiresAt);
  }

  clearSessionMemory(): void {
    this.session.clearMemory();
  }

  async bindDeviceGrant(
    input: OpenTuDeviceBindingInput
  ): Promise<OpenTuRefreshResult> {
    if (!input.grantId.trim() || !input.deviceCode.trim()) {
      throw new Error('OpenTu device grant is incomplete');
    }
    const publicJwk = normalizeP256PublicJwk(input.publicJwk);
    const pendingCredential: StoredOpenTuCredential = {
      credentialId: '__pending_device_binding__',
      refreshToken: '__pending_device_binding__',
      publicJwk,
      jkt: await calculateJwkThumbprint(publicJwk),
      privateKey: input.privateKey,
      updatedAt: this.now(),
    };
    const response = await this.sendProofRequest(
      `${OPENTU_AUTH_PATH}/device-token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_id: input.grantId,
          device_code: input.deviceCode,
        }),
      },
      undefined,
      pendingCredential
    );
    if (!response.ok) {
      throw new OpenTuApiResponseError(
        'OpenTu device grant exchange failed',
        response.status
      );
    }
    const result = parseTokenResponse(
      (await response.json()) as OpenTuTokenResponse,
      this.now()
    );
    if (!result.credentialId) {
      throw new Error('Tuzi did not return an OpenTu credential ID');
    }
    await this.vault.save({
      credentialId: result.credentialId,
      deviceId: result.deviceId,
      refreshToken: result.refreshToken,
      publicJwk,
      privateKey: input.privateKey,
    });
    this.session.setAccessToken(
      result.accessToken,
      result.accessTokenExpiresAt
    );
    return result;
  }

  async getAccount(
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuAccount> {
    const response = await this.request(`${OPENTU_AUTH_PATH}/account`, {
      ...init,
      method: 'GET',
    });
    const payload = await this.readProtectedJson(
      response,
      'OpenTu account request failed'
    );
    const account = isApiEnvelope(payload) ? payload.data : payload;
    if (!isPlainRecord(account)) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an invalid OpenTu account response',
        response.status,
        'invalid_response'
      );
    }
    return {
      ...account,
      displayName:
        typeof account.display_name === 'string'
          ? account.display_name
          : undefined,
      credentialId:
        typeof account.credential_id === 'string'
          ? account.credential_id
          : undefined,
    } as unknown as OpenTuAccount;
  }

  async getPricing(
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuPricing> {
    const response = await this.request(`${OPENTU_AUTH_PATH}/pricing`, {
      ...init,
      method: 'GET',
    });
    const payload = await this.readProtectedJson(
      response,
      'OpenTu pricing request failed'
    );
    if (!isApiEnvelope(payload) || !Array.isArray(payload.data)) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an invalid OpenTu pricing response',
        response.status,
        'invalid_response'
      );
    }
    const { data, success: _success, message: _message, ...metadata } = payload;
    return {
      ...metadata,
      models: data as OpenTuPricingModel[],
    };
  }

  async getUsage(
    query: OpenTuUsageQuery = {},
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuUsagePage> {
    return this.getEnvelopeData<OpenTuUsagePage>(
      `${OPENTU_AUTH_PATH}/usage${buildQuery({
        page: query.page,
        page_size: query.pageSize,
        type: query.type,
        model_name: query.modelName,
        start_time: query.startTime,
        end_time: query.endTime,
      })}`,
      'OpenTu usage request failed',
      init
    );
  }

  async getUsageSummary(
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuUsageSummary> {
    return this.getEnvelopeData<OpenTuUsageSummary>(
      `${OPENTU_AUTH_PATH}/usage/summary`,
      'OpenTu usage summary request failed',
      init
    );
  }

  async getTopups(
    query: OpenTuTopupQuery = {},
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuTopupsPage> {
    return this.getEnvelopeData<OpenTuTopupsPage>(
      `${OPENTU_AUTH_PATH}/topups${buildQuery({
        page: query.page,
        page_size: query.pageSize,
      })}`,
      'OpenTu topups request failed',
      init
    );
  }

  async getTopupInfo(
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuTopupInfo> {
    return this.getEnvelopeData<OpenTuTopupInfo>(
      `${OPENTU_AUTH_PATH}/topup/info`,
      'OpenTu topup info request failed',
      init
    );
  }

  async estimateTopup(
    input: OpenTuTopupOrderInput,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuTopupQuote> {
    const response = await this.request(`${OPENTU_AUTH_PATH}/topup/quote`, {
      ...init,
      method: 'POST',
      headers: jsonHeaders(init.headers),
      body: JSON.stringify(input),
    });
    const payload = await this.readProtectedJson(
      response,
      'OpenTu topup quote request failed'
    );
    if (!isPlainRecord(payload) || !isPlainRecord(payload.data)) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an invalid OpenTu topup quote response',
        response.status,
        'invalid_response'
      );
    }
    return payload.data as unknown as OpenTuTopupQuote;
  }

  async createTopup(
    input: OpenTuTopupOrderInput,
    idempotencyKey: string,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuTopupCreateResult> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey)
      throw new Error('OpenTu topup idempotency key is required');
    const response = await this.request(`${OPENTU_AUTH_PATH}/topup/orders`, {
      ...init,
      method: 'POST',
      headers: jsonHeaders(init.headers),
      body: JSON.stringify({
        ...input,
        idempotency_key: normalizedKey,
      }),
    });
    const payload = await this.readProtectedJson(
      response,
      'OpenTu topup order request failed'
    );
    if (!isPlainRecord(payload)) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an invalid OpenTu topup order response',
        response.status,
        'invalid_response'
      );
    }
    const nestedData = isPlainRecord(payload.data) ? payload.data : {};
    const paymentUrl =
      typeof nestedData.payment_url === 'string'
        ? nestedData.payment_url
        : typeof payload.payment_url === 'string'
        ? payload.payment_url
        : typeof payload.data === 'string'
        ? payload.data
        : '';
    const tradeNo =
      typeof nestedData.trade_no === 'string'
        ? nestedData.trade_no
        : typeof payload.trade_no === 'string'
        ? payload.trade_no
        : '';
    const completed =
      typeof nestedData.completed === 'boolean'
        ? nestedData.completed
        : typeof payload.completed === 'boolean'
        ? payload.completed
        : undefined;
    const qrcodeUrl =
      typeof nestedData.qrcode_url === 'string'
        ? nestedData.qrcode_url
        : typeof payload.qrcode_url === 'string'
        ? payload.qrcode_url
        : '';
    const qrcodeContent =
      typeof nestedData.qrcode_content === 'string'
        ? nestedData.qrcode_content
        : typeof payload.qrcode_content === 'string'
        ? payload.qrcode_content
        : '';
    if (
      !tradeNo ||
      (!paymentUrl && !qrcodeUrl && !qrcodeContent && completed !== true)
    ) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an incomplete OpenTu topup order response',
        response.status,
        'invalid_response'
      );
    }
    return {
      ...payload,
      ...nestedData,
      trade_no: tradeNo,
      payment_url: paymentUrl,
      qrcode_url: qrcodeUrl,
      qrcode_content: qrcodeContent,
      completed,
    } as OpenTuTopupCreateResult;
  }

  async queryTopup(
    input: OpenTuTopupQueryInput,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuTopupQueryResult> {
    const tradeNo = input.trade_no.trim();
    if (!tradeNo) throw new Error('OpenTu topup trade number is required');
    return this.getEnvelopeData<OpenTuTopupQueryResult>(
      `${OPENTU_AUTH_PATH}/topup/orders/query`,
      'OpenTu topup query failed',
      {
        ...init,
        method: 'POST',
        headers: jsonHeaders(init.headers),
        body: JSON.stringify({ trade_no: tradeNo }),
      }
    );
  }

  async getDevices(
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuDevice[]> {
    return this.getEnvelopeData<OpenTuDevice[]>(
      `${OPENTU_AUTH_PATH}/account/devices`,
      'OpenTu devices request failed',
      init
    );
  }

  async revokeDevice(
    deviceId: number | string,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuDeviceRevokeResult> {
    const normalizedId = String(deviceId).trim();
    if (!normalizedId) throw new Error('OpenTu device ID is required');
    return this.getEnvelopeData<OpenTuDeviceRevokeResult>(
      `${OPENTU_AUTH_PATH}/account/devices/${encodeURIComponent(
        normalizedId
      )}/revoke`,
      'OpenTu device revoke failed',
      { ...init, method: 'POST' }
    );
  }

  async ensureManagedProviderGroups(
    idempotencyKey: string,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuManagedProviderGroup[]> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey) {
      throw new Error('OpenTu managed-key idempotency key is required');
    }
    const response = await this.request(
      `${OPENTU_AUTH_PATH}/managed-keys/ensure`,
      {
        ...init,
        method: 'POST',
        headers: jsonHeaders(init.headers),
        body: JSON.stringify({ idempotency_key: normalizedKey }),
      }
    );
    const payload = await this.readProtectedJson(
      response,
      'OpenTu managed keys request failed'
    );
    const value = isApiEnvelope(payload) ? payload.data : payload;
    const groups = isPlainRecord(value) ? value.groups : undefined;
    if (!Array.isArray(groups) || !groups.every(isManagedProviderGroup)) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an invalid OpenTu managed keys response',
        response.status,
        'invalid_response'
      );
    }
    return groups;
  }

  async rotateManagedProviderGroup(
    group: string,
    idempotencyKey: string,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<OpenTuManagedProviderGroup> {
    const normalizedGroup = group.trim();
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedGroup) throw new Error('OpenTu managed group is required');
    if (!normalizedKey) {
      throw new Error('OpenTu managed-key idempotency key is required');
    }
    const response = await this.request(
      `${OPENTU_AUTH_PATH}/managed-keys/${encodeURIComponent(
        normalizedGroup
      )}/rotate`,
      {
        ...init,
        method: 'POST',
        headers: jsonHeaders(init.headers),
        body: JSON.stringify({ idempotency_key: normalizedKey }),
      }
    );
    const payload = await this.readProtectedJson(
      response,
      'OpenTu managed key rotation failed'
    );
    const value = isApiEnvelope(payload) ? payload.data : payload;
    const candidate =
      isPlainRecord(value) && isPlainRecord(value.group) ? value.group : value;
    if (!isManagedProviderGroup(candidate)) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an invalid OpenTu managed key response',
        response.status,
        'invalid_response'
      );
    }
    return candidate;
  }

  relay(
    path: string,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<Response> {
    const method = init.method || 'GET';
    return this.request(toOpenTuRelayPath(path, method), init);
  }

  request(
    path: string,
    init: OpenTuProtectedRequestInit = {}
  ): Promise<Response> {
    if (!path.startsWith('/') || path.startsWith('//')) {
      return Promise.reject(new Error('OpenTu API path must be root-relative'));
    }
    return this.requestWithRefresh(path, init);
  }

  private async getEnvelopeData<T>(
    path: string,
    failureMessage: string,
    init: OpenTuProtectedRequestInit
  ): Promise<T> {
    const response = await this.request(path, {
      ...init,
      method: init.method || 'GET',
    });
    const payload = await this.readProtectedJson(response, failureMessage);
    if (!isApiEnvelope(payload) || payload.data === undefined) {
      throw new OpenTuApiResponseError(
        'Tuzi returned an invalid OpenTu API response',
        response.status,
        'invalid_response'
      );
    }
    return payload.data as T;
  }

  private async readProtectedJson(
    response: Response,
    failureMessage: string
  ): Promise<unknown> {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // The response error below remains useful even if the body is empty.
    }

    const record = isPlainRecord(payload) ? payload : null;
    const errorCode =
      typeof record?.error === 'string'
        ? record.error
        : typeof record?.code === 'string'
        ? record.code
        : '';
    const errorDescription =
      typeof record?.error_description === 'string'
        ? record.error_description
        : typeof record?.message === 'string'
        ? record.message
        : '';
    const businessFailure = isApiEnvelope(payload) && payload.success === false;
    if (!response.ok || businessFailure) {
      throw new OpenTuApiResponseError(
        errorDescription || failureMessage,
        response.status,
        errorCode,
        errorDescription
      );
    }
    return payload;
  }

  private async requestWithRefresh(
    path: string,
    init: OpenTuProtectedRequestInit
  ): Promise<Response> {
    let accessToken = this.session.getAccessToken(this.now(), 5_000);
    if (!accessToken) {
      accessToken = (await this.refresh()).accessToken;
    }

    const response = await this.sendProofRequest(path, init, accessToken);
    if (!(await isInvalidAccessToken(response))) return response;

    response.body?.cancel().catch(() => undefined);
    accessToken = (await this.refresh()).accessToken;
    return this.sendProofRequest(path, init, accessToken);
  }

  private refresh(): Promise<OpenTuRefreshResult> {
    return this.session.refresh((credential) =>
      this.performRefresh(credential)
    );
  }

  private async performRefresh(
    credential: StoredOpenTuCredential
  ): Promise<OpenTuRefreshResult> {
    const response = await this.sendProofRequest(
      `${OPENTU_AUTH_PATH}/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: credential.refreshToken }),
      },
      undefined,
      credential
    );
    const payload = await this.readProtectedJson(
      response,
      'OpenTu token refresh failed'
    );
    return parseTokenResponse(payload as OpenTuTokenResponse, this.now());
  }

  private async sendProofRequest(
    path: string,
    init: OpenTuProtectedRequestInit,
    accessToken?: string,
    suppliedCredential?: StoredOpenTuCredential
  ): Promise<Response> {
    const credential = suppliedCredential || (await this.vault.load());
    if (!credential) throw new Error('No bound OpenTu credential is available');

    const url = new URL(path, this.origin).href;
    const method = (init.method || 'GET').toUpperCase();
    const fetcher = init.fetcher || this.fetcher;
    let nonce = this.session.consumeNonce(url, this.now()) || undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers = withoutClientAuthHeaders(init.headers);
      headers.set(
        'DPoP',
        await createDpopProof({
          privateKey: credential.privateKey,
          publicJwk: credential.publicJwk,
          method,
          url,
          accessToken,
          nonce,
        })
      );
      if (accessToken) headers.set('Authorization', `DPoP ${accessToken}`);

      const { fetcher: _requestFetcher, ...requestInit } = init;
      const response = await fetcher(url, {
        ...requestInit,
        method,
        headers,
        credentials: 'omit',
      } as RequestInit);
      const challengedNonce = response.headers.get('DPoP-Nonce')?.trim();
      if (attempt === 0 && response.status === 401 && challengedNonce) {
        response.body?.cancel().catch(() => undefined);
        this.session.setNonce(
          url,
          challengedNonce,
          this.now() + NONCE_LIFETIME_MS
        );
        nonce = this.session.consumeNonce(url, this.now()) || undefined;
        continue;
      }
      return response;
    }
    throw new Error('OpenTu DPoP nonce retry limit exceeded');
  }
}

let defaultClient: OpenTuApiClient | null = null;

export function getOpenTuApiClient(): OpenTuApiClient | null {
  if (typeof indexedDB === 'undefined' || typeof crypto === 'undefined') {
    return null;
  }
  defaultClient ||= new OpenTuApiClient();
  return defaultClient;
}
