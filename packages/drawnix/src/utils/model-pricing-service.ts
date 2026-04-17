import {
  providerPricingCacheSettings,
  type ProviderProfile,
} from './settings-manager';
import type {
  ModelPrice,
  PricingApiResponse,
  PricingEndpointInfo,
  PricingGroup,
  PricingGroupPrice,
  ProviderPricingCache,
} from './model-pricing-types';

type PricingListener = () => void;
type FetchAndCacheOptions = {
  force?: boolean;
};

type ResolvedProviderPricingConfig = {
  pricingUrl: string;
  pricingGroup: string;
  cnyPerUsd: number;
};

type SharedPricingResponseCacheEntry = {
  fetchedAt: number;
  ttlMs: number;
  response: PricingApiResponse;
};

const TUZI_HOST = 'api.tu-zi.com';
export const DEFAULT_TUZI_CNY_PER_USD = 0.7;
export const MODEL_PRICING_CACHE_TTL_MS = 5 * 60 * 1000;
export const TUZI_PRICING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function normalizePricingUrl(pricingUrl: string): string {
  return pricingUrl.trim();
}

function stripPricingUrlSearch(pricingUrl: string): string {
  const normalized = normalizePricingUrl(pricingUrl);
  if (!normalized) return normalized;
  try {
    const url = new URL(normalized);
    return `${url.origin}${url.pathname}`;
  } catch {
    return normalized.split('?')[0];
  }
}

export function derivePricingUrl(baseUrl: string): string {
  try {
    const origin = new URL(baseUrl).origin;
    return `${origin}/api/pricing`;
  } catch {
    return '';
  }
}

function isTuziProvider(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === TUZI_HOST;
  } catch {
    return false;
  }
}

function isTuziPricingUrl(pricingUrl: string): boolean {
  const normalized = normalizePricingUrl(pricingUrl);
  if (!normalized) return false;

  try {
    const url = new URL(normalized);
    return url.host === TUZI_HOST && url.pathname === '/api/pricing';
  } catch {
    return stripPricingUrlSearch(normalized) === `https://${TUZI_HOST}/api/pricing`;
  }
}

export function getPricingCacheTtlMs(pricingUrl: string): number {
  return isTuziPricingUrl(pricingUrl)
    ? TUZI_PRICING_CACHE_TTL_MS
    : MODEL_PRICING_CACHE_TTL_MS;
}

export function resolveProviderPricingConfig(
  profile: Pick<ProviderProfile, 'baseUrl' | 'pricingUrl' | 'pricingGroup' | 'cnyPerUsd'>
): ResolvedProviderPricingConfig | null {
  const explicitPricingUrl = normalizePricingUrl(profile.pricingUrl || '');
  const pricingUrl =
    explicitPricingUrl ||
    (profile.baseUrl ? derivePricingUrl(profile.baseUrl) : '');

  if (!pricingUrl) {
    return null;
  }

  return {
    pricingUrl,
    pricingGroup: profile.pricingGroup || 'default',
    cnyPerUsd:
      profile.cnyPerUsd ??
      (isTuziProvider(profile.baseUrl || '') ? DEFAULT_TUZI_CNY_PER_USD : 1),
  };
}

function computeModelPrice(
  gp: PricingGroupPrice,
  groupRatio: number,
  cnyPerUsd: number
): ModelPrice {
  // quota_type=1: token 计费（用 model_ratio）
  if (gp.quota_type === 1) {
    const inputUsd = round4(gp.model_ratio * 2 * groupRatio);
    const outputUsd = round4(gp.model_ratio * 2 * gp.model_completion_ratio * groupRatio);
    return {
      inputCnyMtok: round4(inputUsd * cnyPerUsd),
      outputCnyMtok: round4(outputUsd * cnyPerUsd),
      flatCny: null,
      billingType: 'token',
    };
  }
  // quota_type=0: 按次计费, quota_type=2: 按秒计费（都用 model_price）
  const flatUsd = round4(gp.model_price * groupRatio);
  return {
    inputCnyMtok: null,
    outputCnyMtok: null,
    flatCny: round4(flatUsd * cnyPerUsd),
    billingType: gp.quota_type === 2 ? 'per-second' : 'flat',
  };
}

export function formatModelPrice(price: ModelPrice): string {
  if (price.billingType === 'per-second' && price.flatCny != null && price.flatCny > 0) {
    return `¥${price.flatCny.toFixed(2)}/秒`;
  }
  if (price.billingType === 'flat' && price.flatCny != null && price.flatCny > 0) {
    return `¥${price.flatCny.toFixed(2)}/次`;
  }
  if (
    price.billingType === 'token' &&
    price.inputCnyMtok != null &&
    price.outputCnyMtok != null &&
    (price.inputCnyMtok > 0 || price.outputCnyMtok > 0)
  ) {
    return `¥${price.inputCnyMtok.toFixed(2)}/¥${price.outputCnyMtok.toFixed(2)} 百万token`;
  }
  return '';
}

class ModelPricingService {
  private cacheMap = new Map<string, ProviderPricingCache>();
  private listeners = new Set<PricingListener>();
  private sharedResponseCacheMap = new Map<string, SharedPricingResponseCacheEntry>();
  private inflightRequestMap = new Map<string, Promise<PricingApiResponse>>();
  private version = 0;

  constructor() {
    const saved = providerPricingCacheSettings.get();
    if (Array.isArray(saved)) {
      saved.forEach((c) => this.cacheMap.set(c.profileId, c));
    }
  }

  subscribe(listener: PricingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  private buildSharedCacheKey(pricingUrl: string, apiKey: string): string {
    return `${normalizePricingUrl(pricingUrl)}\n${apiKey}`;
  }

  private buildSourceSignature(
    pricingUrl: string,
    groupName: string,
    cnyPerUsd: number
  ): string {
    return `${stripPricingUrlSearch(pricingUrl)}\n${groupName || 'default'}\n${round4(cnyPerUsd)}`;
  }

  private isFresh(
    fetchedAt: number | undefined,
    ttlMs: number,
    now = Date.now()
  ): boolean {
    return typeof fetchedAt === 'number' && now - fetchedAt < ttlMs;
  }

  private pruneExpiredSharedResponses(now = Date.now()): void {
    this.sharedResponseCacheMap.forEach((entry, key) => {
      if (!this.isFresh(entry.fetchedAt, entry.ttlMs, now)) {
        this.sharedResponseCacheMap.delete(key);
      }
    });
  }

  private async fetchPricingResponse(
    pricingUrl: string,
    apiKey: string,
    options: FetchAndCacheOptions = {}
  ): Promise<PricingApiResponse> {
    const normalizedPricingUrl = normalizePricingUrl(pricingUrl);
    const requestKey = this.buildSharedCacheKey(normalizedPricingUrl, apiKey);
    const ttlMs = getPricingCacheTtlMs(normalizedPricingUrl);
    const now = Date.now();

    this.pruneExpiredSharedResponses(now);

    if (!options.force) {
      const cached = this.sharedResponseCacheMap.get(requestKey);
      if (cached && this.isFresh(cached.fetchedAt, cached.ttlMs, now)) {
        return cached.response;
      }
    }

    const inflight = this.inflightRequestMap.get(requestKey);
    if (inflight) {
      return inflight;
    }

    const promise = (async () => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const response = await fetch(normalizedPricingUrl, { headers });
      if (!response.ok) {
        throw new Error(`Pricing API error: ${response.status}`);
      }
      const json = (await response.json()) as PricingApiResponse;
      if (!json.data?.group_info || !json.data?.model_info) {
        throw new Error('Invalid pricing API response');
      }
      this.sharedResponseCacheMap.set(requestKey, {
        fetchedAt: Date.now(),
        ttlMs,
        response: json,
      });
      return json;
    })();

    this.inflightRequestMap.set(requestKey, promise);

    try {
      return await promise;
    } finally {
      this.inflightRequestMap.delete(requestKey);
    }
  }

  private buildProviderCache(
    profileId: string,
    json: PricingApiResponse,
    groupName: string,
    cnyPerUsd: number,
    sourceSignature: string
  ): ProviderPricingCache {
    const groups: PricingGroup[] = Object.entries(json.data.group_info).map(
      ([name, info]) => ({
        name,
        displayName: info.DisplayName || name,
        ratio: info.GroupRatio ?? 1,
      })
    );

    const effectiveGroup = groupName || 'default';
    const groupInfo = json.data.group_info[effectiveGroup];
    const groupRatio = groupInfo?.GroupRatio ?? 1;

    const prices: Record<string, ModelPrice> = {};
    const modelEndpoints: Record<string, Record<string, PricingEndpointInfo>> = {};
    for (const model of json.data.model_info) {
      const groupPrices = model.price_info?.[effectiveGroup];
      const gp: PricingGroupPrice | undefined = groupPrices?.['default'];
      if (!gp) continue;
      const firstDocs = Object.values(model.endpoints || {}).find((ep) => ep.docs)?.docs;
      prices[model.model_name] = {
        ...computeModelPrice(gp, groupRatio, cnyPerUsd),
        description: model.description || undefined,
        docsUrl: firstDocs || undefined,
      };
      if (model.endpoints && Object.keys(model.endpoints).length > 0) {
        modelEndpoints[model.model_name] = model.endpoints;
      }
    }

    return {
      profileId,
      fetchedAt: Date.now(),
      sourceSignature,
      groups,
      prices,
      modelEndpoints,
    };
  }

  async fetchAndCache(
    profileId: string,
    pricingUrl: string,
    apiKey: string,
    groupName: string,
    cnyPerUsd: number,
    options: FetchAndCacheOptions = {}
  ): Promise<ProviderPricingCache> {
    const normalizedPricingUrl = normalizePricingUrl(pricingUrl);
    const ttlMs = getPricingCacheTtlMs(normalizedPricingUrl);
    const sourceSignature = this.buildSourceSignature(
      normalizedPricingUrl,
      groupName,
      cnyPerUsd
    );
    const cached = this.cacheMap.get(profileId);
    if (
      !options.force &&
      cached &&
      cached.sourceSignature === sourceSignature &&
      this.isFresh(cached.fetchedAt, ttlMs)
    ) {
      return cached;
    }

    const json = await this.fetchPricingResponse(
      normalizedPricingUrl,
      apiKey,
      options
    );
    const cache = this.buildProviderCache(
      profileId,
      json,
      groupName,
      cnyPerUsd,
      sourceSignature
    );

    this.cacheMap.set(profileId, cache);
    this.persist();
    this.notify();
    return cache;
  }

  getCache(profileId: string): ProviderPricingCache | null {
    return this.cacheMap.get(profileId) ?? null;
  }

  getModelPrice(profileId: string | undefined | null, modelId: string): ModelPrice | null {
    if (!profileId) return null;
    return this.cacheMap.get(profileId)?.prices[modelId] ?? null;
  }

  getModelEndpoints(
    profileId: string | undefined | null,
    modelId: string
  ): Record<string, PricingEndpointInfo> | null {
    if (!profileId) return null;
    return this.cacheMap.get(profileId)?.modelEndpoints?.[modelId] ?? null;
  }

  getGroups(profileId: string): PricingGroup[] {
    return this.cacheMap.get(profileId)?.groups ?? [];
  }

  removeCache(profileId: string): void {
    if (this.cacheMap.delete(profileId)) {
      this.persist();
      this.notify();
    }
  }

  getVersion(): number {
    return this.version;
  }

  warmupProfiles(profiles: ProviderProfile[]): void {
    profiles
      .filter((profile) => profile.enabled !== false)
      .forEach((profile) => {
        const pricingConfig = resolveProviderPricingConfig(profile);
        if (!pricingConfig) {
          return;
        }
        void this.fetchAndCache(
          profile.id,
          pricingConfig.pricingUrl,
          profile.apiKey,
          pricingConfig.pricingGroup,
          pricingConfig.cnyPerUsd
        ).catch((error) => {
          console.warn(
            `[ModelPricingService] Warmup failed for profile ${profile.id}:`,
            error
          );
        });
      });
  }

  private persist(): void {
    const caches = Array.from(this.cacheMap.values());
    void providerPricingCacheSettings.update(caches);
  }
}

export const modelPricingService = new ModelPricingService();
